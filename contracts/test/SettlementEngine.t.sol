// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {SettlementEngine} from "../src/SettlementEngine.sol";
import {RestrictedToken, MockUSD, MockScheduleService} from "./mocks/Mocks.sol";

contract SettlementEngineTest is Test {
    SettlementEngine engine;
    RestrictedToken loan;
    MockUSD usd;
    MockScheduleService hss;

    address admin = makeAddr("admin");
    address venue = makeAddr("venue");
    address buyer = makeAddr("buyerDesk");
    address seller = makeAddr("sellerDesk");
    address outsider = makeAddr("outsider");

    uint256 constant PAR = 5_000_000; // $5m par, 0 decimals
    uint256 constant CASH = 4_950_000_000_000; // 99.00 price, 6 decimals
    bytes32 constant RFQ = keccak256("rfq-1/quote-3");

    function setUp() public {
        vm.warp(1_800_000_000);
        hss = new MockScheduleService();
        vm.etch(address(0x16b), address(hss).code);
        hss = MockScheduleService(address(0x16b));

        engine = new SettlementEngine(admin, venue);
        vm.deal(address(engine), 10 ether);

        loan = new RestrictedToken("Term Loan B 2031 Tranche A", "TLB-A");
        usd = new MockUSD();

        loan.setEligible(seller, true);
        loan.setEligible(buyer, true);
        usd.grantKyc(seller, true);
        usd.grantKyc(buyer, true);

        loan.mint(seller, 20_000_000);
        usd.mint(buyer, 10_000_000_000_000);

        vm.prank(seller);
        loan.approve(address(engine), type(uint256).max);
        vm.prank(buyer);
        usd.approve(address(engine), type(uint256).max);
    }

    function _create() internal returns (uint256 id, bytes32 h) {
        vm.prank(venue);
        (id, h) = engine.createTrade(
            SettlementEngine.Instruction({
                loanToken: address(loan),
                cashToken: address(usd),
                buyer: buyer,
                seller: seller,
                par: PAR,
                cash: CASH,
                settleAt: uint64(block.timestamp + 1 days),
                expiresAt: uint64(block.timestamp + 2 days),
                rfqRef: RFQ
            })
        );
    }

    function _approveBoth(uint256 id, bytes32 h) internal {
        vm.prank(buyer);
        engine.approve(id, h);
        vm.prank(seller);
        engine.approve(id, h);
    }

    // ------------------------------------------------------------------ creation

    function test_create_requiresVenue() public {
        vm.expectRevert();
        vm.prank(outsider);
        engine.createTrade(
            SettlementEngine.Instruction(address(loan), address(usd), buyer, seller, PAR, CASH, 1, 2, RFQ)
        );
    }

    function test_create_storesInstruction() public {
        (uint256 id, bytes32 h) = _create();
        SettlementEngine.Trade memory t = engine.getTrade(id);
        assertEq(uint8(t.state), uint8(SettlementEngine.State.AwaitingApprovals));
        assertEq(t.par, PAR);
        assertEq(t.cash, CASH);
        assertEq(engine.hashOf(id), h);
    }

    // ------------------------------------------------------------------ approvals

    function test_approve_onlyPartiesAndExactHash() public {
        (uint256 id, bytes32 h) = _create();
        vm.expectRevert(abi.encodeWithSelector(SettlementEngine.NotParty.selector, id, outsider));
        vm.prank(outsider);
        engine.approve(id, h);

        vm.expectRevert(abi.encodeWithSelector(SettlementEngine.HashMismatch.selector, id));
        vm.prank(buyer);
        engine.approve(id, keccak256("different economics"));
    }

    function test_approve_oneSideIsNotEnough() public {
        (uint256 id, bytes32 h) = _create();
        vm.prank(buyer);
        engine.approve(id, h);
        SettlementEngine.Trade memory t = engine.getTrade(id);
        assertEq(uint8(t.state), uint8(SettlementEngine.State.AwaitingApprovals));
        assertTrue(t.buyerApproved);
        assertFalse(t.sellerApproved);

        vm.expectRevert(abi.encodeWithSelector(SettlementEngine.AlreadyApproved.selector, id));
        vm.prank(buyer);
        engine.approve(id, h);
    }

    function test_bothApprovals_scheduleThroughHSS() public {
        (uint256 id, bytes32 h) = _create();
        _approveBoth(id, h);
        SettlementEngine.Trade memory t = engine.getTrade(id);
        assertEq(uint8(t.state), uint8(SettlementEngine.State.Scheduled));
        assertTrue(t.scheduleAddress != address(0));
        assertEq(hss.count(), 1);
        (address to, uint256 expiry, uint256 gasLimit, bytes memory data, address payer,) = hss.scheduled(0);
        assertEq(to, address(engine));
        assertEq(expiry, t.settleAt + engine.SCHEDULE_MARGIN());
        assertEq(gasLimit, engine.scheduledGasLimit());
        assertEq(payer, address(engine));
        assertEq(data, abi.encodeWithSelector(SettlementEngine.settle.selector, id));
    }

    function test_scheduleUnavailable_keepsTradeExecutable() public {
        hss.setFailNext(true);
        (uint256 id, bytes32 h) = _create();
        _approveBoth(id, h);
        SettlementEngine.Trade memory t = engine.getTrade(id);
        assertEq(uint8(t.state), uint8(SettlementEngine.State.Scheduled));
        assertEq(t.scheduleAddress, address(0));
        vm.warp(t.settleAt);
        engine.settle(id);
        assertEq(uint8(engine.getTrade(id).state), uint8(SettlementEngine.State.Settled));
    }

    // ------------------------------------------------------------------ settlement

    function test_settle_atomicHappyPath_firedBySchedule() public {
        (uint256 id, bytes32 h) = _create();
        _approveBoth(id, h);
        SettlementEngine.Trade memory t = engine.getTrade(id);

        // The network fires at the schedule expiry; the block timestamp may lag it slightly.
        (, uint256 expiry,,,,) = hss.scheduled(0);
        vm.warp(expiry - 1);
        assertGe(expiry - 1, t.settleAt, "margin keeps execution at or after settleAt");
        (bool ok,) = hss.fire(0);
        assertTrue(ok);

        assertEq(loan.balanceOf(buyer), PAR);
        assertEq(loan.balanceOf(seller), 20_000_000 - PAR);
        assertEq(usd.balanceOf(seller), CASH);
        assertEq(usd.balanceOf(buyer), 10_000_000_000_000 - CASH);
        assertEq(uint8(engine.getTrade(id).state), uint8(SettlementEngine.State.Settled));
    }

    function test_settle_tooEarly() public {
        (uint256 id, bytes32 h) = _create();
        _approveBoth(id, h);
        vm.expectRevert(abi.encodeWithSelector(SettlementEngine.TooEarly.selector, id, engine.getTrade(id).settleAt));
        engine.settle(id);
    }

    function test_settle_cannotReplay() public {
        (uint256 id, bytes32 h) = _create();
        _approveBoth(id, h);
        vm.warp(engine.getTrade(id).settleAt);
        engine.settle(id);
        vm.expectRevert(
            abi.encodeWithSelector(SettlementEngine.InvalidState.selector, id, SettlementEngine.State.Settled)
        );
        engine.settle(id);
    }

    function test_settle_buyerEligibilityRevoked_fullRevert() public {
        (uint256 id, bytes32 h) = _create();
        _approveBoth(id, h);
        vm.warp(engine.getTrade(id).settleAt);

        loan.setEligible(buyer, false); // compliance officer revokes the buyer

        uint256 lb = loan.balanceOf(buyer);
        uint256 ls = loan.balanceOf(seller);
        uint256 ub = usd.balanceOf(buyer);
        uint256 us = usd.balanceOf(seller);

        vm.expectEmit(true, false, false, true);
        emit SettlementEngine.TradeFailed(id, abi.encodeWithSelector(RestrictedToken.NotEligible.selector, buyer));
        engine.settle(id);

        SettlementEngine.Trade memory t = engine.getTrade(id);
        assertEq(uint8(t.state), uint8(SettlementEngine.State.Failed));
        assertEq(t.failureReason, abi.encodeWithSelector(RestrictedToken.NotEligible.selector, buyer));
        assertEq(loan.balanceOf(buyer), lb);
        assertEq(loan.balanceOf(seller), ls);
        assertEq(usd.balanceOf(buyer), ub);
        assertEq(usd.balanceOf(seller), us);
    }

    function test_settle_cashLegFails_assetLegRolledBack() public {
        (uint256 id, bytes32 h) = _create();
        _approveBoth(id, h);
        vm.warp(engine.getTrade(id).settleAt);

        vm.prank(buyer);
        usd.approve(address(engine), 0); // buyer pulled the cash authorisation

        engine.settle(id);
        assertEq(uint8(engine.getTrade(id).state), uint8(SettlementEngine.State.Failed));
        assertEq(loan.balanceOf(buyer), 0, "asset leg must roll back");
        assertEq(usd.balanceOf(seller), 0);
    }

    function test_settle_insufficientCash_fails() public {
        (uint256 id, bytes32 h) = _create();
        _approveBoth(id, h);
        vm.warp(engine.getTrade(id).settleAt);
        uint256 bal = usd.balanceOf(buyer);
        vm.prank(buyer);
        usd.transfer(seller, bal); // buyer spent the cash elsewhere
        engine.settle(id);
        assertEq(uint8(engine.getTrade(id).state), uint8(SettlementEngine.State.Failed));
    }

    function test_settle_pausedToken_fails() public {
        (uint256 id, bytes32 h) = _create();
        _approveBoth(id, h);
        vm.warp(engine.getTrade(id).settleAt);
        loan.setPaused(true);
        engine.settle(id);
        assertEq(uint8(engine.getTrade(id).state), uint8(SettlementEngine.State.Failed));
    }

    function test_executeLegs_onlySelf() public {
        (uint256 id,) = _create();
        vm.expectRevert(SettlementEngine.OnlySelf.selector);
        vm.prank(venue);
        engine.executeLegs(id);
    }

    function test_settle_afterExpiry_reverts() public {
        (uint256 id, bytes32 h) = _create();
        _approveBoth(id, h);
        vm.warp(engine.getTrade(id).expiresAt + 1);
        vm.expectRevert(abi.encodeWithSelector(SettlementEngine.Expired.selector, id, engine.getTrade(id).expiresAt));
        engine.settle(id);
    }

    // ------------------------------------------------------------------ recovery

    function test_reissue_afterFailure_requiresFreshApprovals() public {
        (uint256 id, bytes32 h) = _create();
        _approveBoth(id, h);
        vm.warp(engine.getTrade(id).settleAt);
        loan.setEligible(buyer, false);
        engine.settle(id);

        loan.setEligible(buyer, true);
        vm.prank(venue);
        engine.reissue(id, uint64(block.timestamp + 1 hours), uint64(block.timestamp + 2 hours));
        SettlementEngine.Trade memory t = engine.getTrade(id);
        assertEq(uint8(t.state), uint8(SettlementEngine.State.AwaitingApprovals));
        assertFalse(t.buyerApproved);
        assertFalse(t.sellerApproved);
        assertEq(t.failureReason.length, 0);

        // Dates changed, so the old hash no longer approves.
        vm.expectRevert(abi.encodeWithSelector(SettlementEngine.HashMismatch.selector, id));
        vm.prank(buyer);
        engine.approve(id, h);

        bytes32 h2 = engine.hashOf(id);
        _approveBoth(id, h2);
        vm.warp(engine.getTrade(id).settleAt);
        engine.settle(id);
        assertEq(uint8(engine.getTrade(id).state), uint8(SettlementEngine.State.Settled));
        assertEq(loan.balanceOf(buyer), PAR);
    }

    function test_cancel_deletesSchedule() public {
        (uint256 id, bytes32 h) = _create();
        _approveBoth(id, h);
        vm.prank(seller);
        engine.cancel(id);
        assertEq(uint8(engine.getTrade(id).state), uint8(SettlementEngine.State.Cancelled));
        (,,,,, bool deleted) = hss.scheduled(0);
        assertTrue(deleted);

        // A fired schedule for a cancelled trade must not move anything.
        vm.warp(block.timestamp + 1 days);
        vm.expectRevert("deleted");
        hss.fire(0);
    }

    function test_cancel_onlyPartiesOrVenue() public {
        (uint256 id,) = _create();
        vm.expectRevert(abi.encodeWithSelector(SettlementEngine.NotParty.selector, id, outsider));
        vm.prank(outsider);
        engine.cancel(id);
    }

    function test_preflight() public {
        (uint256 id,) = _create();
        (bool a, bool b, bool c, bool d) = engine.preflight(id);
        assertTrue(a && b && c && d);
        vm.prank(seller);
        loan.approve(address(engine), 0);
        (, b,,) = engine.preflight(id);
        assertFalse(b);
    }
}
