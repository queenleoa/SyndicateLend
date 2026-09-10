// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {SettlementEngine} from "../src/SettlementEngine.sol";

/// forge script script/DeploySettlementEngine.s.sol --rpc-url hedera_testnet --broadcast \
///   --private-key $OPERATOR_PRIVATE_KEY
contract DeploySettlementEngine is Script {
    function run() external {
        address admin = vm.envAddress("OPERATOR_EVM_ADDRESS");
        // The RFQ venue service signs with the operator key in the demo deployment.
        address venue = vm.envOr("VENUE_ADDRESS", admin);
        uint256 fund = vm.envOr("ENGINE_FUND_WEI", uint256(5 ether)); // HBAR to pay scheduled executions

        vm.startBroadcast();
        SettlementEngine engine = new SettlementEngine(admin, venue);
        if (fund > 0) {
            (bool ok,) = address(engine).call{value: fund}("");
            require(ok, "fund");
        }
        vm.stopBroadcast();

        console.log("SettlementEngine:", address(engine));
    }
}
