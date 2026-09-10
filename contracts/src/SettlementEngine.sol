// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IHederaScheduleService, HederaScheduleServiceLib} from "./interfaces/IHederaScheduleService.sol";

/// @title SettlementEngine
/// @notice Atomic delivery-versus-payment for tokenised syndicated-loan interests.
///
///  A settlement instruction binds a buyer and seller to fixed economics. Each desk approves the
///  instruction hash from its own institutional wallet (a Privy quorum-controlled wallet in the
///  reference deployment). Once both desks have approved, the engine schedules `settle(tradeId)`
///  through the Hedera Schedule Service for the agreed settlement time. At execution the loan
///  token (ATS ERC-3643 security) moves seller -> buyer and the payment token (HTS mock USD)
///  moves buyer -> seller inside one transaction. If either leg, any compliance hook, or any
///  balance/allowance check fails, both legs revert and the trade is marked Failed with the
///  on-chain revert reason so operations can correct and reissue.
///
///  Trade state machine (mirrors the product spec):
///    AwaitingApprovals -> Scheduled -> Settled
///    AwaitingApprovals -> Cancelled
///    Scheduled         -> Failed -> AwaitingApprovals (reissue)
///    Scheduled         -> Cancelled
contract SettlementEngine is AccessControl, ReentrancyGuard {
    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    enum State {
        None,
        AwaitingApprovals,
        Scheduled,
        Settled,
        Failed,
        Cancelled
    }

    /// @notice Immutable economics of a settlement instruction, as agreed in the RFQ.
    struct Instruction {
        address loanToken; // ATS security token (1 unit = smallest par unit)
        address cashToken; // HTS mock USD via ERC-20 facade
        address buyer; // buyer desk wallet
        address seller; // seller desk wallet
        uint256 par; // loan token amount (smallest unit)
        uint256 cash; // payment amount (smallest unit)
        uint64 settleAt; // earliest execution time (unix seconds)
        uint64 expiresAt; // instruction expiry (unix seconds)
        bytes32 rfqRef; // hash of the accepted RFQ / quote (HCS anchored)
    }

    struct Trade {
        address loanToken; // ATS security token (1 unit = smallest par unit)
        address cashToken; // HTS mock USD via ERC-20 facade
        address buyer; // buyer desk wallet
        address seller; // seller desk wallet
        uint256 par; // loan token amount (smallest unit)
        uint256 cash; // payment amount (smallest unit)
        uint64 settleAt; // earliest execution time (unix seconds)
        uint64 expiresAt; // instruction expiry (unix seconds)
        bytes32 rfqRef; // hash of the accepted RFQ / quote (HCS anchored)
        State state;
        bool buyerApproved;
        bool sellerApproved;
        address scheduleAddress; // HSS schedule entity, zero if not scheduled on-chain
        bytes failureReason; // last revert data when state == Failed
    }

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    /// @notice Role allowed to create and cancel settlement instructions (RFQ venue / agent service).
    bytes32 public constant VENUE_ROLE = keccak256("VENUE_ROLE");

    uint256 public nextTradeId = 1;
    mapping(uint256 => Trade) private _trades;

    /// @notice Gas limit forwarded to the scheduled `settle` call.
    uint256 public scheduledGasLimit = 3_000_000;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event TradeCreated(
        uint256 indexed tradeId, address indexed buyer, address indexed seller, Instruction instruction, bytes32 instructionHash
    );
    event TradeApproved(uint256 indexed tradeId, address indexed approver, bool isBuyer);
    event TradeScheduled(uint256 indexed tradeId, address scheduleAddress, uint64 settleAt);
    event ScheduleUnavailable(uint256 indexed tradeId, int64 responseCode);
    event TradeSettled(uint256 indexed tradeId, address indexed buyer, address indexed seller, uint256 par, uint256 cash);
    event TradeFailed(uint256 indexed tradeId, bytes reason);
    event TradeReissued(uint256 indexed tradeId);
    event TradeCancelled(uint256 indexed tradeId, address indexed by);
    event ScheduledGasLimitUpdated(uint256 gasLimit);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error InvalidState(uint256 tradeId, State current);
    error NotParty(uint256 tradeId, address caller);
    error HashMismatch(uint256 tradeId);
    error AlreadyApproved(uint256 tradeId);
    error TooEarly(uint256 tradeId, uint64 settleAt);
    error Expired(uint256 tradeId, uint64 expiresAt);
    error OnlySelf();
    error BadInstruction(string reason);

    constructor(address admin, address venue) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(VENUE_ROLE, venue);
    }

    /// @dev HBAR held here pays for scheduled executions (the engine is the schedule payer).
    receive() external payable {}

    // ---------------------------------------------------------------------
    // Instruction lifecycle
    // ---------------------------------------------------------------------

    /// @notice Create a settlement instruction from an accepted RFQ.
    function createTrade(Instruction calldata i)
        external
        onlyRole(VENUE_ROLE)
        returns (uint256 tradeId, bytes32 instructionHash)
    {
        if (i.buyer == address(0) || i.seller == address(0) || i.buyer == i.seller) revert BadInstruction("parties");
        if (i.loanToken == address(0) || i.cashToken == address(0)) revert BadInstruction("tokens");
        if (i.par == 0 || i.cash == 0) revert BadInstruction("amounts");
        if (i.expiresAt <= i.settleAt || i.expiresAt <= block.timestamp) revert BadInstruction("dates");

        tradeId = nextTradeId++;
        Trade storage t = _trades[tradeId];
        t.loanToken = i.loanToken;
        t.cashToken = i.cashToken;
        t.buyer = i.buyer;
        t.seller = i.seller;
        t.par = i.par;
        t.cash = i.cash;
        t.settleAt = i.settleAt;
        t.expiresAt = i.expiresAt;
        t.rfqRef = i.rfqRef;
        t.state = State.AwaitingApprovals;

        instructionHash = _hash(tradeId, t);
        emit TradeCreated(tradeId, i.buyer, i.seller, i, instructionHash);
    }

    /// @notice A desk approves the exact economics it reviewed. Binding the approval to the
    ///         instruction hash guarantees both desks approved identical terms.
    function approve(uint256 tradeId, bytes32 instructionHash) external {
        Trade storage t = _trades[tradeId];
        if (t.state != State.AwaitingApprovals) revert InvalidState(tradeId, t.state);
        if (instructionHash != _hash(tradeId, t)) revert HashMismatch(tradeId);
        if (block.timestamp >= t.expiresAt) revert Expired(tradeId, t.expiresAt);

        bool isBuyer;
        if (msg.sender == t.buyer) {
            if (t.buyerApproved) revert AlreadyApproved(tradeId);
            t.buyerApproved = true;
            isBuyer = true;
        } else if (msg.sender == t.seller) {
            if (t.sellerApproved) revert AlreadyApproved(tradeId);
            t.sellerApproved = true;
        } else {
            revert NotParty(tradeId, msg.sender);
        }
        emit TradeApproved(tradeId, msg.sender, isBuyer);

        if (t.buyerApproved && t.sellerApproved) {
            t.state = State.Scheduled;
            _schedule(tradeId, t);
        }
    }

    /// @notice Execute the atomic exchange. Called by the Hedera Schedule Service at `settleAt`,
    ///         or by anyone once the settlement time has passed (all preconditions are on-chain).
    function settle(uint256 tradeId) external nonReentrant {
        Trade storage t = _trades[tradeId];
        if (t.state != State.Scheduled) revert InvalidState(tradeId, t.state);
        if (block.timestamp < t.settleAt) revert TooEarly(tradeId, t.settleAt);
        if (block.timestamp > t.expiresAt) revert Expired(tradeId, t.expiresAt);

        // Both legs run in an external self-call so that a revert in either leg (balance,
        // allowance, ATS compliance, HTS KYC/freeze) rolls back both and is captured here.
        try this.executeLegs(tradeId) {
            t.state = State.Settled;
            t.scheduleAddress = address(0);
            emit TradeSettled(tradeId, t.buyer, t.seller, t.par, t.cash);
        } catch (bytes memory reason) {
            t.state = State.Failed;
            t.failureReason = reason;
            t.scheduleAddress = address(0);
            emit TradeFailed(tradeId, reason);
        }
    }

    /// @dev Delivery-versus-payment legs. Only callable by this contract (via `settle`).
    function executeLegs(uint256 tradeId) external {
        if (msg.sender != address(this)) revert OnlySelf();
        Trade storage t = _trades[tradeId];
        // Asset leg: loan interest seller -> buyer. ATS re-checks KYC / control list / pause here.
        require(IERC20(t.loanToken).transferFrom(t.seller, t.buyer, t.par), "loan leg");
        // Cash leg: payment buyer -> seller. HTS enforces KYC / freeze / pause natively.
        require(IERC20(t.cashToken).transferFrom(t.buyer, t.seller, t.cash), "cash leg");
    }

    /// @notice After a Failed settlement, put the instruction back for fresh approvals.
    function reissue(uint256 tradeId, uint64 newSettleAt, uint64 newExpiresAt) external {
        Trade storage t = _trades[tradeId];
        if (t.state != State.Failed) revert InvalidState(tradeId, t.state);
        if (!(hasRole(VENUE_ROLE, msg.sender) || msg.sender == t.buyer || msg.sender == t.seller)) {
            revert NotParty(tradeId, msg.sender);
        }
        if (newExpiresAt <= newSettleAt || newExpiresAt <= block.timestamp) revert BadInstruction("dates");
        t.settleAt = newSettleAt;
        t.expiresAt = newExpiresAt;
        t.buyerApproved = false;
        t.sellerApproved = false;
        delete t.failureReason;
        t.state = State.AwaitingApprovals;
        emit TradeReissued(tradeId);
    }

    /// @notice Cancel an unsettled instruction. Deletes the pending schedule if one exists.
    function cancel(uint256 tradeId) external {
        Trade storage t = _trades[tradeId];
        if (t.state != State.AwaitingApprovals && t.state != State.Scheduled && t.state != State.Failed) {
            revert InvalidState(tradeId, t.state);
        }
        if (!(hasRole(VENUE_ROLE, msg.sender) || msg.sender == t.buyer || msg.sender == t.seller)) {
            revert NotParty(tradeId, msg.sender);
        }
        if (t.scheduleAddress != address(0)) {
            // Best effort: a schedule that already executed or expired cannot be deleted.
            IHederaScheduleService(HederaScheduleServiceLib.HSS).deleteSchedule(t.scheduleAddress);
            t.scheduleAddress = address(0);
        }
        t.state = State.Cancelled;
        emit TradeCancelled(tradeId, msg.sender);
    }

    function setScheduledGasLimit(uint256 gasLimit) external onlyRole(DEFAULT_ADMIN_ROLE) {
        scheduledGasLimit = gasLimit;
        emit ScheduledGasLimitUpdated(gasLimit);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getTrade(uint256 tradeId) external view returns (Trade memory) {
        return _trades[tradeId];
    }

    function hashOf(uint256 tradeId) external view returns (bytes32) {
        return _hash(tradeId, _trades[tradeId]);
    }

    /// @notice Read-only pre-settlement checks a front end can display before execution.
    ///         Eligibility (KYC / control list) is enforced by the tokens at execution time.
    function preflight(uint256 tradeId)
        external
        view
        returns (bool sellerHasPar, bool sellerAllowance, bool buyerHasCash, bool buyerAllowance)
    {
        Trade storage t = _trades[tradeId];
        sellerHasPar = IERC20(t.loanToken).balanceOf(t.seller) >= t.par;
        sellerAllowance = IERC20(t.loanToken).allowance(t.seller, address(this)) >= t.par;
        buyerHasCash = IERC20(t.cashToken).balanceOf(t.buyer) >= t.cash;
        buyerAllowance = IERC20(t.cashToken).allowance(t.buyer, address(this)) >= t.cash;
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    function _hash(uint256 tradeId, Trade storage t) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                block.chainid,
                address(this),
                tradeId,
                t.loanToken,
                t.cashToken,
                t.buyer,
                t.seller,
                t.par,
                t.cash,
                t.settleAt,
                t.expiresAt,
                t.rfqRef
            )
        );
    }

    function _schedule(uint256 tradeId, Trade storage t) internal {
        bytes memory callData = abi.encodeWithSelector(this.settle.selector, tradeId);
        // If the settlement time is already past, execution is due now; the schedule service still
        // requires a future expiry, so give it a minimal one.
        uint256 expiry = t.settleAt > block.timestamp ? t.settleAt : block.timestamp + 5;
        (bool ok, bytes memory ret) = HederaScheduleServiceLib.HSS.call(
            abi.encodeWithSelector(
                IHederaScheduleService.scheduleCall.selector, address(this), expiry, scheduledGasLimit, uint64(0), callData
            )
        );
        if (ok && ret.length >= 64) {
            (int64 rc, address scheduleAddress) = abi.decode(ret, (int64, address));
            if (rc == HederaScheduleServiceLib.SUCCESS) {
                t.scheduleAddress = scheduleAddress;
                emit TradeScheduled(tradeId, scheduleAddress, t.settleAt);
                return;
            }
            emit ScheduleUnavailable(tradeId, rc);
            return;
        }
        // Non-Hedera EVM (tests) or system-contract failure: the trade stays Scheduled and can be
        // executed by calling settle() after settleAt.
        emit ScheduleUnavailable(tradeId, -1);
    }
}
