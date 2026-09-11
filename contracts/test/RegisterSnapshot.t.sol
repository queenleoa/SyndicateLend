// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {RegisterSnapshot} from "../src/RegisterSnapshot.sol";

contract StubToken {
    mapping(address => uint256) public balanceOf;

    function set(address a, uint256 v) external {
        balanceOf[a] = v;
    }
}

contract RegisterSnapshotTest is Test {
    RegisterSnapshot internal reader;
    StubToken internal token;

    function setUp() public {
        reader = new RegisterSnapshot();
        token = new StubToken();
    }

    function test_snapshot_manyHolders_oneCall() public {
        uint256 n = 200;
        address[] memory holders = new address[](n);
        uint256 expected;
        for (uint256 i = 0; i < n; i++) {
            holders[i] = address(uint160(0x1000 + i));
            token.set(holders[i], i * 1000);
            expected += i * 1000;
        }
        (uint256[] memory out, uint256 total) = reader.snapshot(address(token), holders);
        assertEq(out.length, n);
        assertEq(out[7], 7000);
        assertEq(out[199], 199000);
        assertEq(total, expected);
        assertEq(reader.balances(address(token), holders)[42], 42000);
    }

    function test_snapshot_empty() public view {
        address[] memory none = new address[](0);
        (uint256[] memory out, uint256 total) = reader.snapshot(address(token), none);
        assertEq(out.length, 0);
        assertEq(total, 0);
    }
}
