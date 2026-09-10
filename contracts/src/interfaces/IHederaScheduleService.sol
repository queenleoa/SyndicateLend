// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

/// @title Hedera Schedule Service system contract (HIP-755 / HIP-1215 subset)
/// @notice Callable at the reserved address 0x16b on Hedera networks.
///         Only the entry points SyndicateLend uses are declared here.
interface IHederaScheduleService {
    /// @notice Schedule a contract call to `to` with `callData`, to execute at `expirySecond`.
    ///         The calling contract is the payer of the scheduled execution and must hold HBAR.
    /// @return responseCode HederaResponseCodes value (22 == SUCCESS)
    /// @return scheduleAddress EVM address of the created schedule entity
    function scheduleCall(
        address to,
        uint256 expirySecond,
        uint256 gasLimit,
        uint64 value,
        bytes memory callData
    ) external returns (int64 responseCode, address scheduleAddress);

    /// @notice Delete a schedule previously created by the caller.
    function deleteSchedule(address scheduleAddress) external returns (int64 responseCode);

    /// @notice Whether the network has capacity to schedule `gasLimit` of work at `expirySecond`.
    function hasScheduleCapacity(uint256 expirySecond, uint256 gasLimit) external view returns (bool);
}

library HederaScheduleServiceLib {
    address internal constant HSS = address(0x16b);
    int64 internal constant SUCCESS = 22;
}
