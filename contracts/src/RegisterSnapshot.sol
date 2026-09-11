// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IBalanceOf {
    function balanceOf(address account) external view returns (uint256);
}

/// @title RegisterSnapshot
/// @notice One-call balance snapshot of a security's holders, so an off-chain reader (the CRE enclave via the
///         mirror node's `contracts/call`) can take the register snapshot for an accrual period in a single
///         request regardless of how many holders the register has.
contract RegisterSnapshot {
    /// @notice Balances of `holders` on `token`, in the same order.
    function balances(address token, address[] calldata holders) external view returns (uint256[] memory out) {
        out = new uint256[](holders.length);
        for (uint256 i = 0; i < holders.length; i++) {
            out[i] = IBalanceOf(token).balanceOf(holders[i]);
        }
    }

    /// @notice Balances plus their sum, for a quick total-supply cross-check.
    function snapshot(address token, address[] calldata holders) external view returns (uint256[] memory out, uint256 total) {
        out = new uint256[](holders.length);
        for (uint256 i = 0; i < holders.length; i++) {
            out[i] = IBalanceOf(token).balanceOf(holders[i]);
            total += out[i];
        }
    }
}
