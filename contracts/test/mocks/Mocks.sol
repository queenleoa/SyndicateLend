// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Stand-in for the ATS ERC-3643 security token: transfers require both parties to be
///      eligible (KYC + control list) and the token to be unpaused. Mirrors the compliance
///      checks the diamond performs inside `transferFrom`.
contract RestrictedToken is ERC20 {
    mapping(address => bool) public eligible;
    bool public paused;
    address public issuer;

    error NotEligible(address account);
    error TokenPaused();

    constructor(string memory n, string memory s) ERC20(n, s) {
        issuer = msg.sender;
    }

    function decimals() public pure override returns (uint8) {
        return 0;
    }

    function setEligible(address a, bool ok) external {
        eligible[a] = ok;
    }

    function setPaused(bool p) external {
        paused = p;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (paused) revert TokenPaused();
        if (from != address(0) && !eligible[from]) revert NotEligible(from);
        if (to != address(0) && !eligible[to]) revert NotEligible(to);
        super._update(from, to, value);
    }
}

/// @dev Stand-in for the HTS mock-USD token behind its ERC-20 facade. HTS enforces KYC natively;
///      we emulate that with a kyc map.
contract MockUSD is ERC20 {
    mapping(address => bool) public kyc;

    error KycNotGranted(address account);

    constructor() ERC20("Mock USD", "mUSD") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function grantKyc(address a, bool ok) external {
        kyc[a] = ok;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && !kyc[from]) revert KycNotGranted(from);
        if (to != address(0) && !kyc[to]) revert KycNotGranted(to);
        super._update(from, to, value);
    }
}

/// @dev Minimal Hedera Schedule Service double, etched at 0x16b in tests. Records the scheduled
///      call so a test can "fire" it as the network would.
contract MockScheduleService {
    struct Scheduled {
        address to;
        uint256 expirySecond;
        uint256 gasLimit;
        bytes callData;
        address payer;
        bool deleted;
    }

    Scheduled[] public scheduled;
    bool public failNext;

    function setFailNext(bool f) external {
        failNext = f;
    }

    function scheduleCall(address to, uint256 expirySecond, uint256 gasLimit, uint64, bytes memory callData)
        external
        returns (int64, address)
    {
        if (failNext) {
            failNext = false;
            return (int64(305), address(0)); // arbitrary non-success code
        }
        scheduled.push(Scheduled(to, expirySecond, gasLimit, callData, msg.sender, false));
        // Deterministic pseudo schedule address for assertions.
        return (int64(22), address(uint160(0x5c4ed0000 + scheduled.length)));
    }

    function deleteSchedule(address scheduleAddress) external returns (int64) {
        uint256 idx = uint160(scheduleAddress) - 0x5c4ed0000 - 1;
        require(scheduled[idx].payer == msg.sender, "not payer");
        scheduled[idx].deleted = true;
        return 22;
    }

    function hasScheduleCapacity(uint256, uint256) external pure returns (bool) {
        return true;
    }

    function count() external view returns (uint256) {
        return scheduled.length;
    }

    /// @dev Execute a recorded schedule the way the network does: the payer contract is the sender.
    function fire(uint256 idx) external returns (bool ok, bytes memory ret) {
        Scheduled storage s = scheduled[idx];
        require(!s.deleted, "deleted");
        (ok, ret) = s.to.call{gas: s.gasLimit}(s.callData);
    }
}
