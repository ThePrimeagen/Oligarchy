// Code generated from QEMU query-qmp-schema. DO NOT EDIT.
package qmp

// AddFd is the QMP command "add-fd".
func AddFd(args AddFdArgs) Command[AddFdArgs, AddFdResult] {
	return Command[AddFdArgs, AddFdResult]{name: "add-fd", Args: args}
}

// AddClient is the QMP command "add_client".
func AddClient(args AddClientArgs) Command[AddClientArgs, Empty] {
	return Command[AddClientArgs, Empty]{name: "add_client", Args: args}
}

// AnnounceSelf is the QMP command "announce-self".
func AnnounceSelf(args AnnounceSelfArgs) Command[AnnounceSelfArgs, Empty] {
	return Command[AnnounceSelfArgs, Empty]{name: "announce-self", Args: args}
}

// Balloon is the QMP command "balloon".
func Balloon(args BalloonArgs) Command[BalloonArgs, Empty] {
	return Command[BalloonArgs, Empty]{name: "balloon", Args: args}
}

// BlockCommit is the QMP command "block-commit".
func BlockCommit(args BlockCommitArgs) Command[BlockCommitArgs, Empty] {
	return Command[BlockCommitArgs, Empty]{name: "block-commit", Args: args}
}

// BlockDirtyBitmapAdd is the QMP command "block-dirty-bitmap-add".
func BlockDirtyBitmapAdd(args BlockDirtyBitmapAddArgs) Command[BlockDirtyBitmapAddArgs, Empty] {
	return Command[BlockDirtyBitmapAddArgs, Empty]{name: "block-dirty-bitmap-add", Args: args}
}

// BlockDirtyBitmapClear is the QMP command "block-dirty-bitmap-clear".
func BlockDirtyBitmapClear(args BlockDirtyBitmapRemoveArgs) Command[BlockDirtyBitmapRemoveArgs, Empty] {
	return Command[BlockDirtyBitmapRemoveArgs, Empty]{name: "block-dirty-bitmap-clear", Args: args}
}

// BlockDirtyBitmapDisable is the QMP command "block-dirty-bitmap-disable".
func BlockDirtyBitmapDisable(args BlockDirtyBitmapRemoveArgs) Command[BlockDirtyBitmapRemoveArgs, Empty] {
	return Command[BlockDirtyBitmapRemoveArgs, Empty]{name: "block-dirty-bitmap-disable", Args: args}
}

// BlockDirtyBitmapEnable is the QMP command "block-dirty-bitmap-enable".
func BlockDirtyBitmapEnable(args BlockDirtyBitmapRemoveArgs) Command[BlockDirtyBitmapRemoveArgs, Empty] {
	return Command[BlockDirtyBitmapRemoveArgs, Empty]{name: "block-dirty-bitmap-enable", Args: args}
}

// BlockDirtyBitmapMerge is the QMP command "block-dirty-bitmap-merge".
func BlockDirtyBitmapMerge(args BlockDirtyBitmapMergeArgs) Command[BlockDirtyBitmapMergeArgs, Empty] {
	return Command[BlockDirtyBitmapMergeArgs, Empty]{name: "block-dirty-bitmap-merge", Args: args}
}

// BlockDirtyBitmapRemove is the QMP command "block-dirty-bitmap-remove".
func BlockDirtyBitmapRemove(args BlockDirtyBitmapRemoveArgs) Command[BlockDirtyBitmapRemoveArgs, Empty] {
	return Command[BlockDirtyBitmapRemoveArgs, Empty]{name: "block-dirty-bitmap-remove", Args: args}
}

// BlockExportAdd is the QMP command "block-export-add".
func BlockExportAdd(args BlockExportAddArgs) Command[BlockExportAddArgs, Empty] {
	return Command[BlockExportAddArgs, Empty]{name: "block-export-add", Args: args}
}

// BlockExportDel is the QMP command "block-export-del".
func BlockExportDel(args BlockExportDelArgs) Command[BlockExportDelArgs, Empty] {
	return Command[BlockExportDelArgs, Empty]{name: "block-export-del", Args: args}
}

// BlockJobCancel is the QMP command "block-job-cancel".
func BlockJobCancel(args BlockJobCancelArgs) Command[BlockJobCancelArgs, Empty] {
	return Command[BlockJobCancelArgs, Empty]{name: "block-job-cancel", Args: args}
}

// BlockJobChange is the QMP command "block-job-change".
func BlockJobChange(args BlockJobChangeArgs) Command[BlockJobChangeArgs, Empty] {
	return Command[BlockJobChangeArgs, Empty]{name: "block-job-change", Args: args}
}

// BlockJobComplete is the QMP command "block-job-complete".
func BlockJobComplete(args BlockJobCompleteArgs) Command[BlockJobCompleteArgs, Empty] {
	return Command[BlockJobCompleteArgs, Empty]{name: "block-job-complete", Args: args}
}

// BlockJobDismiss is the QMP command "block-job-dismiss".
func BlockJobDismiss(args BlockJobDismissArgs) Command[BlockJobDismissArgs, Empty] {
	return Command[BlockJobDismissArgs, Empty]{name: "block-job-dismiss", Args: args}
}

// BlockJobFinalize is the QMP command "block-job-finalize".
func BlockJobFinalize(args BlockJobFinalizeArgs) Command[BlockJobFinalizeArgs, Empty] {
	return Command[BlockJobFinalizeArgs, Empty]{name: "block-job-finalize", Args: args}
}

// BlockJobPause is the QMP command "block-job-pause".
func BlockJobPause(args BlockJobPauseArgs) Command[BlockJobPauseArgs, Empty] {
	return Command[BlockJobPauseArgs, Empty]{name: "block-job-pause", Args: args}
}

// BlockJobResume is the QMP command "block-job-resume".
func BlockJobResume(args BlockJobResumeArgs) Command[BlockJobResumeArgs, Empty] {
	return Command[BlockJobResumeArgs, Empty]{name: "block-job-resume", Args: args}
}

// BlockJobSetSpeed is the QMP command "block-job-set-speed".
func BlockJobSetSpeed(args BlockJobSetSpeedArgs) Command[BlockJobSetSpeedArgs, Empty] {
	return Command[BlockJobSetSpeedArgs, Empty]{name: "block-job-set-speed", Args: args}
}

// BlockLatencyHistogramSet is the QMP command "block-latency-histogram-set".
func BlockLatencyHistogramSet(args BlockLatencyHistogramSetArgs) Command[BlockLatencyHistogramSetArgs, Empty] {
	return Command[BlockLatencyHistogramSetArgs, Empty]{name: "block-latency-histogram-set", Args: args}
}

// BlockSetWriteThreshold is the QMP command "block-set-write-threshold".
func BlockSetWriteThreshold(args BlockSetWriteThresholdArgs) Command[BlockSetWriteThresholdArgs, Empty] {
	return Command[BlockSetWriteThresholdArgs, Empty]{name: "block-set-write-threshold", Args: args}
}

// BlockStream is the QMP command "block-stream".
func BlockStream(args BlockStreamArgs) Command[BlockStreamArgs, Empty] {
	return Command[BlockStreamArgs, Empty]{name: "block-stream", Args: args}
}

// BlockResize is the QMP command "block_resize".
func BlockResize(args BlockResizeArgs) Command[BlockResizeArgs, Empty] {
	return Command[BlockResizeArgs, Empty]{name: "block_resize", Args: args}
}

// BlockSetIoThrottle is the QMP command "block_set_io_throttle".
func BlockSetIoThrottle(args BlockSetIoThrottleArgs) Command[BlockSetIoThrottleArgs, Empty] {
	return Command[BlockSetIoThrottleArgs, Empty]{name: "block_set_io_throttle", Args: args}
}

// BlockdevAdd is the QMP command "blockdev-add".
func BlockdevAdd(args BlockdevAddArgs) Command[BlockdevAddArgs, Empty] {
	return Command[BlockdevAddArgs, Empty]{name: "blockdev-add", Args: args}
}

// BlockdevBackup is the QMP command "blockdev-backup".
func BlockdevBackup(args BlockdevBackupArgs) Command[BlockdevBackupArgs, Empty] {
	return Command[BlockdevBackupArgs, Empty]{name: "blockdev-backup", Args: args}
}

// BlockdevChangeMedium is the QMP command "blockdev-change-medium".
func BlockdevChangeMedium(args BlockdevChangeMediumArgs) Command[BlockdevChangeMediumArgs, Empty] {
	return Command[BlockdevChangeMediumArgs, Empty]{name: "blockdev-change-medium", Args: args}
}

// BlockdevCloseTray is the QMP command "blockdev-close-tray".
func BlockdevCloseTray(args BlockdevCloseTrayArgs) Command[BlockdevCloseTrayArgs, Empty] {
	return Command[BlockdevCloseTrayArgs, Empty]{name: "blockdev-close-tray", Args: args}
}

// BlockdevCreate is the QMP command "blockdev-create".
func BlockdevCreate(args BlockdevCreateArgs) Command[BlockdevCreateArgs, Empty] {
	return Command[BlockdevCreateArgs, Empty]{name: "blockdev-create", Args: args}
}

// BlockdevDel is the QMP command "blockdev-del".
func BlockdevDel(args BlockdevDelArgs) Command[BlockdevDelArgs, Empty] {
	return Command[BlockdevDelArgs, Empty]{name: "blockdev-del", Args: args}
}

// BlockdevInsertMedium is the QMP command "blockdev-insert-medium".
func BlockdevInsertMedium(args BlockdevInsertMediumArgs) Command[BlockdevInsertMediumArgs, Empty] {
	return Command[BlockdevInsertMediumArgs, Empty]{name: "blockdev-insert-medium", Args: args}
}

// BlockdevMirror is the QMP command "blockdev-mirror".
func BlockdevMirror(args BlockdevMirrorArgs) Command[BlockdevMirrorArgs, Empty] {
	return Command[BlockdevMirrorArgs, Empty]{name: "blockdev-mirror", Args: args}
}

// BlockdevOpenTray is the QMP command "blockdev-open-tray".
func BlockdevOpenTray(args BlockdevOpenTrayArgs) Command[BlockdevOpenTrayArgs, Empty] {
	return Command[BlockdevOpenTrayArgs, Empty]{name: "blockdev-open-tray", Args: args}
}

// BlockdevRemoveMedium is the QMP command "blockdev-remove-medium".
func BlockdevRemoveMedium(args BlockdevRemoveMediumArgs) Command[BlockdevRemoveMediumArgs, Empty] {
	return Command[BlockdevRemoveMediumArgs, Empty]{name: "blockdev-remove-medium", Args: args}
}

// BlockdevReopen is the QMP command "blockdev-reopen".
func BlockdevReopen(args BlockdevReopenArgs) Command[BlockdevReopenArgs, Empty] {
	return Command[BlockdevReopenArgs, Empty]{name: "blockdev-reopen", Args: args}
}

// BlockdevSetActive is the QMP command "blockdev-set-active".
func BlockdevSetActive(args BlockdevSetActiveArgs) Command[BlockdevSetActiveArgs, Empty] {
	return Command[BlockdevSetActiveArgs, Empty]{name: "blockdev-set-active", Args: args}
}

// BlockdevSnapshot is the QMP command "blockdev-snapshot".
func BlockdevSnapshot(args BlockdevSnapshotArgs) Command[BlockdevSnapshotArgs, Empty] {
	return Command[BlockdevSnapshotArgs, Empty]{name: "blockdev-snapshot", Args: args}
}

// BlockdevSnapshotDeleteInternalSync is the QMP command "blockdev-snapshot-delete-internal-sync".
func BlockdevSnapshotDeleteInternalSync(args BlockdevSnapshotDeleteInternalSyncArgs) Command[BlockdevSnapshotDeleteInternalSyncArgs, BlockdevSnapshotDeleteInternalSyncResult] {
	return Command[BlockdevSnapshotDeleteInternalSyncArgs, BlockdevSnapshotDeleteInternalSyncResult]{name: "blockdev-snapshot-delete-internal-sync", Args: args}
}

// BlockdevSnapshotInternalSync is the QMP command "blockdev-snapshot-internal-sync".
func BlockdevSnapshotInternalSync(args BlockdevSnapshotInternalSyncArgs) Command[BlockdevSnapshotInternalSyncArgs, Empty] {
	return Command[BlockdevSnapshotInternalSyncArgs, Empty]{name: "blockdev-snapshot-internal-sync", Args: args}
}

// BlockdevSnapshotSync is the QMP command "blockdev-snapshot-sync".
func BlockdevSnapshotSync(args BlockdevSnapshotSyncArgs) Command[BlockdevSnapshotSyncArgs, Empty] {
	return Command[BlockdevSnapshotSyncArgs, Empty]{name: "blockdev-snapshot-sync", Args: args}
}

// CalcDirtyRate is the QMP command "calc-dirty-rate".
func CalcDirtyRate(args CalcDirtyRateArgs) Command[CalcDirtyRateArgs, Empty] {
	return Command[CalcDirtyRateArgs, Empty]{name: "calc-dirty-rate", Args: args}
}

// CancelVcpuDirtyLimit is the QMP command "cancel-vcpu-dirty-limit".
func CancelVcpuDirtyLimit(args CancelVcpuDirtyLimitArgs) Command[CancelVcpuDirtyLimitArgs, Empty] {
	return Command[CancelVcpuDirtyLimitArgs, Empty]{name: "cancel-vcpu-dirty-limit", Args: args}
}

// ChangeBackingFile is the QMP command "change-backing-file".
func ChangeBackingFile(args ChangeBackingFileArgs) Command[ChangeBackingFileArgs, Empty] {
	return Command[ChangeBackingFileArgs, Empty]{name: "change-backing-file", Args: args}
}

// ChangeVncPassword is the QMP command "change-vnc-password".
func ChangeVncPassword(args ChangeVncPasswordArgs) Command[ChangeVncPasswordArgs, Empty] {
	return Command[ChangeVncPasswordArgs, Empty]{name: "change-vnc-password", Args: args}
}

// ChardevAdd is the QMP command "chardev-add".
func ChardevAdd(args ChardevAddArgs) Command[ChardevAddArgs, ChardevAddResult] {
	return Command[ChardevAddArgs, ChardevAddResult]{name: "chardev-add", Args: args}
}

// ChardevChange is the QMP command "chardev-change".
func ChardevChange(args ChardevChangeArgs) Command[ChardevChangeArgs, ChardevAddResult] {
	return Command[ChardevChangeArgs, ChardevAddResult]{name: "chardev-change", Args: args}
}

// ChardevRemove is the QMP command "chardev-remove".
func ChardevRemove(args ChardevRemoveArgs) Command[ChardevRemoveArgs, Empty] {
	return Command[ChardevRemoveArgs, Empty]{name: "chardev-remove", Args: args}
}

// ChardevSendBreak is the QMP command "chardev-send-break".
func ChardevSendBreak(args ChardevSendBreakArgs) Command[ChardevSendBreakArgs, Empty] {
	return Command[ChardevSendBreakArgs, Empty]{name: "chardev-send-break", Args: args}
}

// ClientMigrateInfo is the QMP command "client_migrate_info".
func ClientMigrateInfo(args ClientMigrateInfoArgs) Command[ClientMigrateInfoArgs, Empty] {
	return Command[ClientMigrateInfoArgs, Empty]{name: "client_migrate_info", Args: args}
}

// Closefd is the QMP command "closefd".
func Closefd(args ClosefdArgs) Command[ClosefdArgs, Empty] {
	return Command[ClosefdArgs, Empty]{name: "closefd", Args: args}
}

// Cont is the QMP command "cont".
var Cont = Command[Empty, Empty]{name: "cont"}

// CxlAddDynamicCapacity is the QMP command "cxl-add-dynamic-capacity".
func CxlAddDynamicCapacity(args CxlAddDynamicCapacityArgs) Command[CxlAddDynamicCapacityArgs, Empty] {
	return Command[CxlAddDynamicCapacityArgs, Empty]{name: "cxl-add-dynamic-capacity", Args: args}
}

// CxlInjectCorrectableError is the QMP command "cxl-inject-correctable-error".
func CxlInjectCorrectableError(args CxlInjectCorrectableErrorArgs) Command[CxlInjectCorrectableErrorArgs, Empty] {
	return Command[CxlInjectCorrectableErrorArgs, Empty]{name: "cxl-inject-correctable-error", Args: args}
}

// CxlInjectDramEvent is the QMP command "cxl-inject-dram-event".
func CxlInjectDramEvent(args CxlInjectDramEventArgs) Command[CxlInjectDramEventArgs, Empty] {
	return Command[CxlInjectDramEventArgs, Empty]{name: "cxl-inject-dram-event", Args: args}
}

// CxlInjectGeneralMediaEvent is the QMP command "cxl-inject-general-media-event".
func CxlInjectGeneralMediaEvent(args CxlInjectGeneralMediaEventArgs) Command[CxlInjectGeneralMediaEventArgs, Empty] {
	return Command[CxlInjectGeneralMediaEventArgs, Empty]{name: "cxl-inject-general-media-event", Args: args}
}

// CxlInjectMemoryModuleEvent is the QMP command "cxl-inject-memory-module-event".
func CxlInjectMemoryModuleEvent(args CxlInjectMemoryModuleEventArgs) Command[CxlInjectMemoryModuleEventArgs, Empty] {
	return Command[CxlInjectMemoryModuleEventArgs, Empty]{name: "cxl-inject-memory-module-event", Args: args}
}

// CxlInjectPoison is the QMP command "cxl-inject-poison".
func CxlInjectPoison(args CxlInjectPoisonArgs) Command[CxlInjectPoisonArgs, Empty] {
	return Command[CxlInjectPoisonArgs, Empty]{name: "cxl-inject-poison", Args: args}
}

// CxlInjectUncorrectableErrors is the QMP command "cxl-inject-uncorrectable-errors".
func CxlInjectUncorrectableErrors(args CxlInjectUncorrectableErrorsArgs) Command[CxlInjectUncorrectableErrorsArgs, Empty] {
	return Command[CxlInjectUncorrectableErrorsArgs, Empty]{name: "cxl-inject-uncorrectable-errors", Args: args}
}

// CxlReleaseDynamicCapacity is the QMP command "cxl-release-dynamic-capacity".
func CxlReleaseDynamicCapacity(args CxlReleaseDynamicCapacityArgs) Command[CxlReleaseDynamicCapacityArgs, Empty] {
	return Command[CxlReleaseDynamicCapacityArgs, Empty]{name: "cxl-release-dynamic-capacity", Args: args}
}

// DeviceListProperties is the QMP command "device-list-properties".
func DeviceListProperties(args DeviceListPropertiesArgs) Command[DeviceListPropertiesArgs, []TypeN186] {
	return Command[DeviceListPropertiesArgs, []TypeN186]{name: "device-list-properties", Args: args}
}

// DeviceSyncConfig is the QMP command "device-sync-config".
func DeviceSyncConfig(args DeviceSyncConfigArgs) Command[DeviceSyncConfigArgs, Empty] {
	return Command[DeviceSyncConfigArgs, Empty]{name: "device-sync-config", Args: args}
}

// DeviceAdd is the QMP command "device_add".
func DeviceAdd(args DeviceAddArgs) Command[DeviceAddArgs, Empty] {
	return Command[DeviceAddArgs, Empty]{name: "device_add", Args: args}
}

// DeviceDel is the QMP command "device_del".
func DeviceDel(args DeviceDelArgs) Command[DeviceDelArgs, Empty] {
	return Command[DeviceDelArgs, Empty]{name: "device_del", Args: args}
}

// DisplayReload is the QMP command "display-reload".
func DisplayReload(args DisplayReloadArgs) Command[DisplayReloadArgs, Empty] {
	return Command[DisplayReloadArgs, Empty]{name: "display-reload", Args: args}
}

// DisplayUpdate is the QMP command "display-update".
func DisplayUpdate(args DisplayUpdateArgs) Command[DisplayUpdateArgs, Empty] {
	return Command[DisplayUpdateArgs, Empty]{name: "display-update", Args: args}
}

// DriveBackup is the QMP command "drive-backup".
func DriveBackup(args DriveBackupArgs) Command[DriveBackupArgs, Empty] {
	return Command[DriveBackupArgs, Empty]{name: "drive-backup", Args: args}
}

// DriveMirror is the QMP command "drive-mirror".
func DriveMirror(args DriveMirrorArgs) Command[DriveMirrorArgs, Empty] {
	return Command[DriveMirrorArgs, Empty]{name: "drive-mirror", Args: args}
}

// DumpGuestMemory is the QMP command "dump-guest-memory".
func DumpGuestMemory(args DumpGuestMemoryArgs) Command[DumpGuestMemoryArgs, Empty] {
	return Command[DumpGuestMemoryArgs, Empty]{name: "dump-guest-memory", Args: args}
}

// DumpSkeys is the QMP command "dump-skeys".
func DumpSkeys(args DumpSkeysArgs) Command[DumpSkeysArgs, Empty] {
	return Command[DumpSkeysArgs, Empty]{name: "dump-skeys", Args: args}
}

// Dumpdtb is the QMP command "dumpdtb".
func Dumpdtb(args DumpdtbArgs) Command[DumpdtbArgs, Empty] {
	return Command[DumpdtbArgs, Empty]{name: "dumpdtb", Args: args}
}

// Eject is the QMP command "eject".
func Eject(args EjectArgs) Command[EjectArgs, Empty] {
	return Command[EjectArgs, Empty]{name: "eject", Args: args}
}

// ExpirePassword is the QMP command "expire_password".
func ExpirePassword(args ExpirePasswordArgs) Command[ExpirePasswordArgs, Empty] {
	return Command[ExpirePasswordArgs, Empty]{name: "expire_password", Args: args}
}

// Getfd is the QMP command "getfd".
func Getfd(args GetfdArgs) Command[GetfdArgs, Empty] {
	return Command[GetfdArgs, Empty]{name: "getfd", Args: args}
}

// HumanMonitorCommand is the QMP command "human-monitor-command".
func HumanMonitorCommand(args HumanMonitorCommandArgs) Command[HumanMonitorCommandArgs, string] {
	return Command[HumanMonitorCommandArgs, string]{name: "human-monitor-command", Args: args}
}

// InjectGhesV2Error is the QMP command "inject-ghes-v2-error".
func InjectGhesV2Error(args InjectGhesV2ErrorArgs) Command[InjectGhesV2ErrorArgs, Empty] {
	return Command[InjectGhesV2ErrorArgs, Empty]{name: "inject-ghes-v2-error", Args: args}
}

// InjectNmi is the QMP command "inject-nmi".
var InjectNmi = Command[Empty, Empty]{name: "inject-nmi"}

// InputSendEvent is the QMP command "input-send-event".
func InputSendEvent(args InputSendEventArgs) Command[InputSendEventArgs, Empty] {
	return Command[InputSendEventArgs, Empty]{name: "input-send-event", Args: args}
}

// JobCancel is the QMP command "job-cancel".
func JobCancel(args JobCancelArgs) Command[JobCancelArgs, Empty] {
	return Command[JobCancelArgs, Empty]{name: "job-cancel", Args: args}
}

// JobComplete is the QMP command "job-complete".
func JobComplete(args JobCompleteArgs) Command[JobCompleteArgs, Empty] {
	return Command[JobCompleteArgs, Empty]{name: "job-complete", Args: args}
}

// JobDismiss is the QMP command "job-dismiss".
func JobDismiss(args JobDismissArgs) Command[JobDismissArgs, Empty] {
	return Command[JobDismissArgs, Empty]{name: "job-dismiss", Args: args}
}

// JobFinalize is the QMP command "job-finalize".
func JobFinalize(args JobFinalizeArgs) Command[JobFinalizeArgs, Empty] {
	return Command[JobFinalizeArgs, Empty]{name: "job-finalize", Args: args}
}

// JobPause is the QMP command "job-pause".
func JobPause(args JobPauseArgs) Command[JobPauseArgs, Empty] {
	return Command[JobPauseArgs, Empty]{name: "job-pause", Args: args}
}

// JobResume is the QMP command "job-resume".
func JobResume(args JobResumeArgs) Command[JobResumeArgs, Empty] {
	return Command[JobResumeArgs, Empty]{name: "job-resume", Args: args}
}

// Memsave is the QMP command "memsave".
func Memsave(args MemsaveArgs) Command[MemsaveArgs, Empty] {
	return Command[MemsaveArgs, Empty]{name: "memsave", Args: args}
}

// Migrate is the QMP command "migrate".
func Migrate(args MigrateArgs) Command[MigrateArgs, Empty] {
	return Command[MigrateArgs, Empty]{name: "migrate", Args: args}
}

// MigrateContinue is the QMP command "migrate-continue".
func MigrateContinue(args MigrateContinueArgs) Command[MigrateContinueArgs, Empty] {
	return Command[MigrateContinueArgs, Empty]{name: "migrate-continue", Args: args}
}

// MigrateIncoming is the QMP command "migrate-incoming".
func MigrateIncoming(args MigrateIncomingArgs) Command[MigrateIncomingArgs, Empty] {
	return Command[MigrateIncomingArgs, Empty]{name: "migrate-incoming", Args: args}
}

// MigratePause is the QMP command "migrate-pause".
var MigratePause = Command[Empty, Empty]{name: "migrate-pause"}

// MigrateRecover is the QMP command "migrate-recover".
func MigrateRecover(args MigrateRecoverArgs) Command[MigrateRecoverArgs, Empty] {
	return Command[MigrateRecoverArgs, Empty]{name: "migrate-recover", Args: args}
}

// MigrateSetCapabilities is the QMP command "migrate-set-capabilities".
func MigrateSetCapabilities(args MigrateSetCapabilitiesArgs) Command[MigrateSetCapabilitiesArgs, Empty] {
	return Command[MigrateSetCapabilitiesArgs, Empty]{name: "migrate-set-capabilities", Args: args}
}

// MigrateSetParameters is the QMP command "migrate-set-parameters".
func MigrateSetParameters(args MigrateSetParametersArgs) Command[MigrateSetParametersArgs, Empty] {
	return Command[MigrateSetParametersArgs, Empty]{name: "migrate-set-parameters", Args: args}
}

// MigrateStartPostcopy is the QMP command "migrate-start-postcopy".
var MigrateStartPostcopy = Command[Empty, Empty]{name: "migrate-start-postcopy"}

// MigrateCancel is the QMP command "migrate_cancel".
var MigrateCancel = Command[Empty, Empty]{name: "migrate_cancel"}

// NbdServerAdd is the QMP command "nbd-server-add".
func NbdServerAdd(args NbdServerAddArgs) Command[NbdServerAddArgs, Empty] {
	return Command[NbdServerAddArgs, Empty]{name: "nbd-server-add", Args: args}
}

// NbdServerRemove is the QMP command "nbd-server-remove".
func NbdServerRemove(args NbdServerRemoveArgs) Command[NbdServerRemoveArgs, Empty] {
	return Command[NbdServerRemoveArgs, Empty]{name: "nbd-server-remove", Args: args}
}

// NbdServerStart is the QMP command "nbd-server-start".
func NbdServerStart(args NbdServerStartArgs) Command[NbdServerStartArgs, Empty] {
	return Command[NbdServerStartArgs, Empty]{name: "nbd-server-start", Args: args}
}

// NbdServerStop is the QMP command "nbd-server-stop".
var NbdServerStop = Command[Empty, Empty]{name: "nbd-server-stop"}

// NetdevAdd is the QMP command "netdev_add".
func NetdevAdd(args NetdevAddArgs) Command[NetdevAddArgs, Empty] {
	return Command[NetdevAddArgs, Empty]{name: "netdev_add", Args: args}
}

// NetdevDel is the QMP command "netdev_del".
func NetdevDel(args NetdevDelArgs) Command[NetdevDelArgs, Empty] {
	return Command[NetdevDelArgs, Empty]{name: "netdev_del", Args: args}
}

// ObjectAdd is the QMP command "object-add".
func ObjectAdd(args ObjectAddArgs) Command[ObjectAddArgs, Empty] {
	return Command[ObjectAddArgs, Empty]{name: "object-add", Args: args}
}

// ObjectDel is the QMP command "object-del".
func ObjectDel(args ObjectDelArgs) Command[ObjectDelArgs, Empty] {
	return Command[ObjectDelArgs, Empty]{name: "object-del", Args: args}
}

// Pmemsave is the QMP command "pmemsave".
func Pmemsave(args PmemsaveArgs) Command[PmemsaveArgs, Empty] {
	return Command[PmemsaveArgs, Empty]{name: "pmemsave", Args: args}
}

// QmpCapabilities is the QMP command "qmp_capabilities".
func QmpCapabilities(args QmpCapabilitiesArgs) Command[QmpCapabilitiesArgs, Empty] {
	return Command[QmpCapabilitiesArgs, Empty]{name: "qmp_capabilities", Args: args}
}

// QomGet is the QMP command "qom-get".
func QomGet(args QomGetArgs) Command[QomGetArgs, any] {
	return Command[QomGetArgs, any]{name: "qom-get", Args: args}
}

// QomList is the QMP command "qom-list".
func QomList(args QomListArgs) Command[QomListArgs, []TypeN186] {
	return Command[QomListArgs, []TypeN186]{name: "qom-list", Args: args}
}

// QomListGet is the QMP command "qom-list-get".
func QomListGet(args QomListGetArgs) Command[QomListGetArgs, []TypeN189] {
	return Command[QomListGetArgs, []TypeN189]{name: "qom-list-get", Args: args}
}

// QomListProperties is the QMP command "qom-list-properties".
func QomListProperties(args QomListPropertiesArgs) Command[QomListPropertiesArgs, []TypeN186] {
	return Command[QomListPropertiesArgs, []TypeN186]{name: "qom-list-properties", Args: args}
}

// QomListTypes is the QMP command "qom-list-types".
func QomListTypes(args QomListTypesArgs) Command[QomListTypesArgs, []TypeN192] {
	return Command[QomListTypesArgs, []TypeN192]{name: "qom-list-types", Args: args}
}

// QomSet is the QMP command "qom-set".
func QomSet(args QomSetArgs) Command[QomSetArgs, Empty] {
	return Command[QomSetArgs, Empty]{name: "qom-set", Args: args}
}

// QueryAccelerators is the QMP command "query-accelerators".
var QueryAccelerators = Command[Empty, QueryAcceleratorsResult]{name: "query-accelerators"}

// QueryAcpiOspmStatus is the QMP command "query-acpi-ospm-status".
var QueryAcpiOspmStatus = Command[Empty, []ACPIDEVICEOSTEventInfo]{name: "query-acpi-ospm-status"}

// QueryAudiodevs is the QMP command "query-audiodevs".
var QueryAudiodevs = Command[Empty, []TypeN265]{name: "query-audiodevs"}

// QueryBalloon is the QMP command "query-balloon".
var QueryBalloon = Command[Empty, QueryBalloonResult]{name: "query-balloon"}

// QueryBlock is the QMP command "query-block".
func QueryBlock(args QueryBlockArgs) Command[QueryBlockArgs, []TypeN33] {
	return Command[QueryBlockArgs, []TypeN33]{name: "query-block", Args: args}
}

// QueryBlockExports is the QMP command "query-block-exports".
var QueryBlockExports = Command[Empty, []TypeN90]{name: "query-block-exports"}

// QueryBlockJobs is the QMP command "query-block-jobs".
var QueryBlockJobs = Command[Empty, []TypeN36]{name: "query-block-jobs"}

// QueryBlockstats is the QMP command "query-blockstats".
func QueryBlockstats(args QueryBlockstatsArgs) Command[QueryBlockstatsArgs, []TypeN35] {
	return Command[QueryBlockstatsArgs, []TypeN35]{name: "query-blockstats", Args: args}
}

// QueryChardev is the QMP command "query-chardev".
var QueryChardev = Command[Empty, []TypeN91]{name: "query-chardev"}

// QueryChardevBackends is the QMP command "query-chardev-backends".
var QueryChardevBackends = Command[Empty, []TypeN92]{name: "query-chardev-backends"}

// QueryColoStatus is the QMP command "query-colo-status".
var QueryColoStatus = Command[Empty, QueryColoStatusResult]{name: "query-colo-status"}

// QueryCommandLineOptions is the QMP command "query-command-line-options".
func QueryCommandLineOptions(args QueryCommandLineOptionsArgs) Command[QueryCommandLineOptionsArgs, []TypeN252] {
	return Command[QueryCommandLineOptionsArgs, []TypeN252]{name: "query-command-line-options", Args: args}
}

// QueryCommands is the QMP command "query-commands".
var QueryCommands = Command[Empty, []TypeN183]{name: "query-commands"}

// QueryCpuDefinitions is the QMP command "query-cpu-definitions".
var QueryCpuDefinitions = Command[Empty, []TypeN231]{name: "query-cpu-definitions"}

// QueryCpuModelBaseline is the QMP command "query-cpu-model-baseline".
func QueryCpuModelBaseline(args QueryCpuModelBaselineArgs) Command[QueryCpuModelBaselineArgs, QueryCpuModelBaselineResult] {
	return Command[QueryCpuModelBaselineArgs, QueryCpuModelBaselineResult]{name: "query-cpu-model-baseline", Args: args}
}

// QueryCpuModelComparison is the QMP command "query-cpu-model-comparison".
func QueryCpuModelComparison(args QueryCpuModelComparisonArgs) Command[QueryCpuModelComparisonArgs, QueryCpuModelComparisonResult] {
	return Command[QueryCpuModelComparisonArgs, QueryCpuModelComparisonResult]{name: "query-cpu-model-comparison", Args: args}
}

// QueryCpuModelExpansion is the QMP command "query-cpu-model-expansion".
func QueryCpuModelExpansion(args QueryCpuModelExpansionArgs) Command[QueryCpuModelExpansionArgs, QueryCpuModelExpansionResult] {
	return Command[QueryCpuModelExpansionArgs, QueryCpuModelExpansionResult]{name: "query-cpu-model-expansion", Args: args}
}

// QueryCpusFast is the QMP command "query-cpus-fast".
var QueryCpusFast = Command[Empty, []TypeN202]{name: "query-cpus-fast"}

// QueryCryptodev is the QMP command "query-cryptodev".
var QueryCryptodev = Command[Empty, []TypeN284]{name: "query-cryptodev"}

// QueryCurrentMachine is the QMP command "query-current-machine".
var QueryCurrentMachine = Command[Empty, QueryCurrentMachineResult]{name: "query-current-machine"}

// QueryDirtyRate is the QMP command "query-dirty-rate".
func QueryDirtyRate(args QueryDirtyRateArgs) Command[QueryDirtyRateArgs, QueryDirtyRateResult] {
	return Command[QueryDirtyRateArgs, QueryDirtyRateResult]{name: "query-dirty-rate", Args: args}
}

// QueryDisplayOptions is the QMP command "query-display-options".
var QueryDisplayOptions = Command[Empty, QueryDisplayOptionsResult]{name: "query-display-options"}

// QueryDump is the QMP command "query-dump".
var QueryDump = Command[Empty, QueryDumpResult]{name: "query-dump"}

// QueryDumpGuestMemoryCapability is the QMP command "query-dump-guest-memory-capability".
var QueryDumpGuestMemoryCapability = Command[Empty, QueryDumpGuestMemoryCapabilityResult]{name: "query-dump-guest-memory-capability"}

// QueryFdsets is the QMP command "query-fdsets".
var QueryFdsets = Command[Empty, []TypeN250]{name: "query-fdsets"}

// QueryFirmwareLog is the QMP command "query-firmware-log".
func QueryFirmwareLog(args QueryFirmwareLogArgs) Command[QueryFirmwareLogArgs, QueryFirmwareLogResult] {
	return Command[QueryFirmwareLogArgs, QueryFirmwareLogResult]{name: "query-firmware-log", Args: args}
}

// QueryGicCapabilities is the QMP command "query-gic-capabilities".
var QueryGicCapabilities = Command[Empty, []TypeN255]{name: "query-gic-capabilities"}

// QueryHotpluggableCpus is the QMP command "query-hotpluggable-cpus".
var QueryHotpluggableCpus = Command[Empty, []TypeN212]{name: "query-hotpluggable-cpus"}

// QueryHvBalloonStatusReport is the QMP command "query-hv-balloon-status-report".
var QueryHvBalloonStatusReport = Command[Empty, QueryHvBalloonStatusReportResult]{name: "query-hv-balloon-status-report"}

// QueryIothreads is the QMP command "query-iothreads".
var QueryIothreads = Command[Empty, []TypeN242]{name: "query-iothreads"}

// QueryJobs is the QMP command "query-jobs".
var QueryJobs = Command[Empty, []TypeN17]{name: "query-jobs"}

// QueryKvm is the QMP command "query-kvm".
var QueryKvm = Command[Empty, QueryKvmResult]{name: "query-kvm"}

// QueryMachines is the QMP command "query-machines".
func QueryMachines(args QueryMachinesArgs) Command[QueryMachinesArgs, []TypeN204] {
	return Command[QueryMachinesArgs, []TypeN204]{name: "query-machines", Args: args}
}

// QueryMemdev is the QMP command "query-memdev".
var QueryMemdev = Command[Empty, []TypeN211]{name: "query-memdev"}

// QueryMemoryDevices is the QMP command "query-memory-devices".
var QueryMemoryDevices = Command[Empty, []TypeN219]{name: "query-memory-devices"}

// QueryMemorySizeSummary is the QMP command "query-memory-size-summary".
var QueryMemorySizeSummary = Command[Empty, QueryMemorySizeSummaryResult]{name: "query-memory-size-summary"}

// QueryMice is the QMP command "query-mice".
var QueryMice = Command[Empty, []TypeN143]{name: "query-mice"}

// QueryMigrate is the QMP command "query-migrate".
var QueryMigrate = Command[Empty, QueryMigrateResult]{name: "query-migrate"}

// QueryMigrateCapabilities is the QMP command "query-migrate-capabilities".
var QueryMigrateCapabilities = Command[Empty, []TypeN152]{name: "query-migrate-capabilities"}

// QueryMigrateParameters is the QMP command "query-migrate-parameters".
var QueryMigrateParameters = Command[Empty, MigrateSetParametersArgs]{name: "query-migrate-parameters"}

// QueryName is the QMP command "query-name".
var QueryName = Command[Empty, QueryNameResult]{name: "query-name"}

// QueryNamedBlockNodes is the QMP command "query-named-block-nodes".
func QueryNamedBlockNodes(args QueryNamedBlockNodesArgs) Command[QueryNamedBlockNodesArgs, []TypeN45] {
	return Command[QueryNamedBlockNodesArgs, []TypeN45]{name: "query-named-block-nodes", Args: args}
}

// QueryPci is the QMP command "query-pci".
var QueryPci = Command[Empty, []TypeN269]{name: "query-pci"}

// QueryPrManagers is the QMP command "query-pr-managers".
var QueryPrManagers = Command[Empty, []TypeN21]{name: "query-pr-managers"}

// QueryQmpSchema is the QMP command "query-qmp-schema".
var QueryQmpSchema = Command[Empty, []TypeN184]{name: "query-qmp-schema"}

// QueryReplay is the QMP command "query-replay".
var QueryReplay = Command[Empty, QueryReplayResult]{name: "query-replay"}

// QueryRocker is the QMP command "query-rocker".
func QueryRocker(args QueryRockerArgs) Command[QueryRockerArgs, QueryRockerResult] {
	return Command[QueryRockerArgs, QueryRockerResult]{name: "query-rocker", Args: args}
}

// QueryRockerOfDpaFlows is the QMP command "query-rocker-of-dpa-flows".
func QueryRockerOfDpaFlows(args QueryRockerOfDpaFlowsArgs) Command[QueryRockerOfDpaFlowsArgs, []TypeN124] {
	return Command[QueryRockerOfDpaFlowsArgs, []TypeN124]{name: "query-rocker-of-dpa-flows", Args: args}
}

// QueryRockerOfDpaGroups is the QMP command "query-rocker-of-dpa-groups".
func QueryRockerOfDpaGroups(args QueryRockerOfDpaGroupsArgs) Command[QueryRockerOfDpaGroupsArgs, []TypeN126] {
	return Command[QueryRockerOfDpaGroupsArgs, []TypeN126]{name: "query-rocker-of-dpa-groups", Args: args}
}

// QueryRockerPorts is the QMP command "query-rocker-ports".
func QueryRockerPorts(args QueryRockerPortsArgs) Command[QueryRockerPortsArgs, []TypeN122] {
	return Command[QueryRockerPortsArgs, []TypeN122]{name: "query-rocker-ports", Args: args}
}

// QueryRxFilter is the QMP command "query-rx-filter".
func QueryRxFilter(args QueryRxFilterArgs) Command[QueryRxFilterArgs, []TypeN109] {
	return Command[QueryRxFilterArgs, []TypeN109]{name: "query-rx-filter", Args: args}
}

// QueryS390xCpuPolarization is the QMP command "query-s390x-cpu-polarization".
var QueryS390xCpuPolarization = Command[Empty, QueryS390xCpuPolarizationResult]{name: "query-s390x-cpu-polarization"}

// QuerySev is the QMP command "query-sev".
var QuerySev = Command[Empty, QuerySevResult]{name: "query-sev"}

// QuerySevAttestationReport is the QMP command "query-sev-attestation-report".
func QuerySevAttestationReport(args QuerySevAttestationReportArgs) Command[QuerySevAttestationReportArgs, QuerySevAttestationReportResult] {
	return Command[QuerySevAttestationReportArgs, QuerySevAttestationReportResult]{name: "query-sev-attestation-report", Args: args}
}

// QuerySevCapabilities is the QMP command "query-sev-capabilities".
var QuerySevCapabilities = Command[Empty, QuerySevCapabilitiesResult]{name: "query-sev-capabilities"}

// QuerySevLaunchMeasure is the QMP command "query-sev-launch-measure".
var QuerySevLaunchMeasure = Command[Empty, QuerySevLaunchMeasureResult]{name: "query-sev-launch-measure"}

// QuerySgx is the QMP command "query-sgx".
var QuerySgx = Command[Empty, QuerySgxResult]{name: "query-sgx"}

// QuerySgxCapabilities is the QMP command "query-sgx-capabilities".
var QuerySgxCapabilities = Command[Empty, QuerySgxResult]{name: "query-sgx-capabilities"}

// QuerySpice is the QMP command "query-spice".
var QuerySpice = Command[Empty, QuerySpiceResult]{name: "query-spice"}

// QueryStats is the QMP command "query-stats".
func QueryStats(args QueryStatsArgs) Command[QueryStatsArgs, []TypeN271] {
	return Command[QueryStatsArgs, []TypeN271]{name: "query-stats", Args: args}
}

// QueryStatsSchemas is the QMP command "query-stats-schemas".
func QueryStatsSchemas(args QueryStatsSchemasArgs) Command[QueryStatsSchemasArgs, []TypeN273] {
	return Command[QueryStatsSchemasArgs, []TypeN273]{name: "query-stats-schemas", Args: args}
}

// QueryStatus is the QMP command "query-status".
var QueryStatus = Command[Empty, QueryStatusResult]{name: "query-status"}

// QueryTarget is the QMP command "query-target".
var QueryTarget = Command[Empty, QueryTargetResult]{name: "query-target"}

// QueryTpm is the QMP command "query-tpm".
var QueryTpm = Command[Empty, []TypeN129]{name: "query-tpm"}

// QueryTpmModels is the QMP command "query-tpm-models".
var QueryTpmModels = Command[Empty, []TypeN127]{name: "query-tpm-models"}

// QueryTpmTypes is the QMP command "query-tpm-types".
var QueryTpmTypes = Command[Empty, []TypeN128]{name: "query-tpm-types"}

// QueryUuid is the QMP command "query-uuid".
var QueryUuid = Command[Empty, QueryUuidResult]{name: "query-uuid"}

// QueryVcpuDirtyLimit is the QMP command "query-vcpu-dirty-limit".
var QueryVcpuDirtyLimit = Command[Empty, []TypeN173]{name: "query-vcpu-dirty-limit"}

// QueryVersion is the QMP command "query-version".
var QueryVersion = Command[Empty, VersionInfo]{name: "query-version"}

// QueryVmGenerationId is the QMP command "query-vm-generation-id".
var QueryVmGenerationId = Command[Empty, QueryVmGenerationIdResult]{name: "query-vm-generation-id"}

// QueryVnc is the QMP command "query-vnc".
var QueryVnc = Command[Empty, QueryVncResult]{name: "query-vnc"}

// QueryVncServers is the QMP command "query-vnc-servers".
var QueryVncServers = Command[Empty, []TypeN138]{name: "query-vnc-servers"}

// QueryXenReplicationStatus is the QMP command "query-xen-replication-status".
var QueryXenReplicationStatus = Command[Empty, QueryXenReplicationStatusResult]{name: "query-xen-replication-status"}

// QueryYank is the QMP command "query-yank".
var QueryYank = Command[Empty, []TypeN239]{name: "query-yank"}

// Quit is the QMP command "quit".
var Quit = Command[Empty, Empty]{name: "quit"}

// RemoveFd is the QMP command "remove-fd".
func RemoveFd(args RemoveFdArgs) Command[RemoveFdArgs, Empty] {
	return Command[RemoveFdArgs, Empty]{name: "remove-fd", Args: args}
}

// ReplayBreak is the QMP command "replay-break".
func ReplayBreak(args ReplayBreakArgs) Command[ReplayBreakArgs, Empty] {
	return Command[ReplayBreakArgs, Empty]{name: "replay-break", Args: args}
}

// ReplayDeleteBreak is the QMP command "replay-delete-break".
var ReplayDeleteBreak = Command[Empty, Empty]{name: "replay-delete-break"}

// ReplaySeek is the QMP command "replay-seek".
func ReplaySeek(args ReplaySeekArgs) Command[ReplaySeekArgs, Empty] {
	return Command[ReplaySeekArgs, Empty]{name: "replay-seek", Args: args}
}

// RequestEbpf is the QMP command "request-ebpf".
func RequestEbpf(args RequestEbpfArgs) Command[RequestEbpfArgs, RequestEbpfResult] {
	return Command[RequestEbpfArgs, RequestEbpfResult]{name: "request-ebpf", Args: args}
}

// RingbufRead is the QMP command "ringbuf-read".
func RingbufRead(args RingbufReadArgs) Command[RingbufReadArgs, string] {
	return Command[RingbufReadArgs, string]{name: "ringbuf-read", Args: args}
}

// RingbufWrite is the QMP command "ringbuf-write".
func RingbufWrite(args RingbufWriteArgs) Command[RingbufWriteArgs, Empty] {
	return Command[RingbufWriteArgs, Empty]{name: "ringbuf-write", Args: args}
}

// RtcResetReinjection is the QMP command "rtc-reset-reinjection".
var RtcResetReinjection = Command[Empty, Empty]{name: "rtc-reset-reinjection"}

// Screendump is the QMP command "screendump".
func Screendump(args ScreendumpArgs) Command[ScreendumpArgs, Empty] {
	return Command[ScreendumpArgs, Empty]{name: "screendump", Args: args}
}

// SendKey is the QMP command "send-key".
func SendKey(args SendKeyArgs) Command[SendKeyArgs, Empty] {
	return Command[SendKeyArgs, Empty]{name: "send-key", Args: args}
}

// SetAction is the QMP command "set-action".
func SetAction(args SetActionArgs) Command[SetActionArgs, Empty] {
	return Command[SetActionArgs, Empty]{name: "set-action", Args: args}
}

// SetCpuTopology is the QMP command "set-cpu-topology".
func SetCpuTopology(args SetCpuTopologyArgs) Command[SetCpuTopologyArgs, Empty] {
	return Command[SetCpuTopologyArgs, Empty]{name: "set-cpu-topology", Args: args}
}

// SetNumaNode is the QMP command "set-numa-node".
func SetNumaNode(args SetNumaNodeArgs) Command[SetNumaNodeArgs, Empty] {
	return Command[SetNumaNodeArgs, Empty]{name: "set-numa-node", Args: args}
}

// SetVcpuDirtyLimit is the QMP command "set-vcpu-dirty-limit".
func SetVcpuDirtyLimit(args SetVcpuDirtyLimitArgs) Command[SetVcpuDirtyLimitArgs, Empty] {
	return Command[SetVcpuDirtyLimitArgs, Empty]{name: "set-vcpu-dirty-limit", Args: args}
}

// SetLink is the QMP command "set_link".
func SetLink(args SetLinkArgs) Command[SetLinkArgs, Empty] {
	return Command[SetLinkArgs, Empty]{name: "set_link", Args: args}
}

// SetPassword is the QMP command "set_password".
func SetPassword(args SetPasswordArgs) Command[SetPasswordArgs, Empty] {
	return Command[SetPasswordArgs, Empty]{name: "set_password", Args: args}
}

// SevInjectLaunchSecret is the QMP command "sev-inject-launch-secret".
func SevInjectLaunchSecret(args SevInjectLaunchSecretArgs) Command[SevInjectLaunchSecretArgs, Empty] {
	return Command[SevInjectLaunchSecretArgs, Empty]{name: "sev-inject-launch-secret", Args: args}
}

// SnapshotDelete is the QMP command "snapshot-delete".
func SnapshotDelete(args SnapshotDeleteArgs) Command[SnapshotDeleteArgs, Empty] {
	return Command[SnapshotDeleteArgs, Empty]{name: "snapshot-delete", Args: args}
}

// SnapshotLoad is the QMP command "snapshot-load".
func SnapshotLoad(args SnapshotLoadArgs) Command[SnapshotLoadArgs, Empty] {
	return Command[SnapshotLoadArgs, Empty]{name: "snapshot-load", Args: args}
}

// SnapshotSave is the QMP command "snapshot-save".
func SnapshotSave(args SnapshotSaveArgs) Command[SnapshotSaveArgs, Empty] {
	return Command[SnapshotSaveArgs, Empty]{name: "snapshot-save", Args: args}
}

// Stop is the QMP command "stop".
var Stop = Command[Empty, Empty]{name: "stop"}

// SystemPowerdown is the QMP command "system_powerdown".
var SystemPowerdown = Command[Empty, Empty]{name: "system_powerdown"}

// SystemReset is the QMP command "system_reset".
var SystemReset = Command[Empty, Empty]{name: "system_reset"}

// SystemWakeup is the QMP command "system_wakeup".
var SystemWakeup = Command[Empty, Empty]{name: "system_wakeup"}

// TraceEventGetState is the QMP command "trace-event-get-state".
func TraceEventGetState(args TraceEventGetStateArgs) Command[TraceEventGetStateArgs, []TypeN179] {
	return Command[TraceEventGetStateArgs, []TypeN179]{name: "trace-event-get-state", Args: args}
}

// TraceEventSetState is the QMP command "trace-event-set-state".
func TraceEventSetState(args TraceEventSetStateArgs) Command[TraceEventSetStateArgs, Empty] {
	return Command[TraceEventSetStateArgs, Empty]{name: "trace-event-set-state", Args: args}
}

// Transaction is the QMP command "transaction".
func Transaction(args TransactionArgs) Command[TransactionArgs, Empty] {
	return Command[TransactionArgs, Empty]{name: "transaction", Args: args}
}

// WatchdogSetAction is the QMP command "watchdog-set-action".
func WatchdogSetAction(args WatchdogSetActionArgs) Command[WatchdogSetActionArgs, Empty] {
	return Command[WatchdogSetActionArgs, Empty]{name: "watchdog-set-action", Args: args}
}

// XAccelStats is the QMP command "x-accel-stats".
var XAccelStats = Command[Empty, XAccelStatsResult]{name: "x-accel-stats"}

// XBlockdevAmend is the QMP command "x-blockdev-amend".
func XBlockdevAmend(args XBlockdevAmendArgs) Command[XBlockdevAmendArgs, Empty] {
	return Command[XBlockdevAmendArgs, Empty]{name: "x-blockdev-amend", Args: args}
}

// XBlockdevChange is the QMP command "x-blockdev-change".
func XBlockdevChange(args XBlockdevChangeArgs) Command[XBlockdevChangeArgs, Empty] {
	return Command[XBlockdevChangeArgs, Empty]{name: "x-blockdev-change", Args: args}
}

// XBlockdevSetIothread is the QMP command "x-blockdev-set-iothread".
func XBlockdevSetIothread(args XBlockdevSetIothreadArgs) Command[XBlockdevSetIothreadArgs, Empty] {
	return Command[XBlockdevSetIothreadArgs, Empty]{name: "x-blockdev-set-iothread", Args: args}
}

// XColoLostHeartbeat is the QMP command "x-colo-lost-heartbeat".
var XColoLostHeartbeat = Command[Empty, Empty]{name: "x-colo-lost-heartbeat"}

// XDebugBlockDirtyBitmapSha256 is the QMP command "x-debug-block-dirty-bitmap-sha256".
func XDebugBlockDirtyBitmapSha256(args BlockDirtyBitmapRemoveArgs) Command[BlockDirtyBitmapRemoveArgs, XDebugBlockDirtyBitmapSha256Result] {
	return Command[BlockDirtyBitmapRemoveArgs, XDebugBlockDirtyBitmapSha256Result]{name: "x-debug-block-dirty-bitmap-sha256", Args: args}
}

// XDebugQueryBlockGraph is the QMP command "x-debug-query-block-graph".
var XDebugQueryBlockGraph = Command[Empty, XDebugQueryBlockGraphResult]{name: "x-debug-query-block-graph"}

// XExitPreconfig is the QMP command "x-exit-preconfig".
var XExitPreconfig = Command[Empty, Empty]{name: "x-exit-preconfig"}

// XQueryInterruptControllers is the QMP command "x-query-interrupt-controllers".
var XQueryInterruptControllers = Command[Empty, XAccelStatsResult]{name: "x-query-interrupt-controllers"}

// XQueryIrq is the QMP command "x-query-irq".
var XQueryIrq = Command[Empty, XAccelStatsResult]{name: "x-query-irq"}

// XQueryJit is the QMP command "x-query-jit".
var XQueryJit = Command[Empty, XAccelStatsResult]{name: "x-query-jit"}

// XQueryNuma is the QMP command "x-query-numa".
var XQueryNuma = Command[Empty, XAccelStatsResult]{name: "x-query-numa"}

// XQueryRamblock is the QMP command "x-query-ramblock".
var XQueryRamblock = Command[Empty, XAccelStatsResult]{name: "x-query-ramblock"}

// XQueryRoms is the QMP command "x-query-roms".
var XQueryRoms = Command[Empty, XAccelStatsResult]{name: "x-query-roms"}

// XQueryUsb is the QMP command "x-query-usb".
var XQueryUsb = Command[Empty, XAccelStatsResult]{name: "x-query-usb"}

// XQueryVirtio is the QMP command "x-query-virtio".
var XQueryVirtio = Command[Empty, []TypeN274]{name: "x-query-virtio"}

// XQueryVirtioQueueElement is the QMP command "x-query-virtio-queue-element".
func XQueryVirtioQueueElement(args XQueryVirtioQueueElementArgs) Command[XQueryVirtioQueueElementArgs, XQueryVirtioQueueElementResult] {
	return Command[XQueryVirtioQueueElementArgs, XQueryVirtioQueueElementResult]{name: "x-query-virtio-queue-element", Args: args}
}

// XQueryVirtioQueueStatus is the QMP command "x-query-virtio-queue-status".
func XQueryVirtioQueueStatus(args XQueryVirtioQueueStatusArgs) Command[XQueryVirtioQueueStatusArgs, XQueryVirtioQueueStatusResult] {
	return Command[XQueryVirtioQueueStatusArgs, XQueryVirtioQueueStatusResult]{name: "x-query-virtio-queue-status", Args: args}
}

// XQueryVirtioStatus is the QMP command "x-query-virtio-status".
func XQueryVirtioStatus(args XQueryVirtioStatusArgs) Command[XQueryVirtioStatusArgs, XQueryVirtioStatusResult] {
	return Command[XQueryVirtioStatusArgs, XQueryVirtioStatusResult]{name: "x-query-virtio-status", Args: args}
}

// XQueryVirtioVhostQueueStatus is the QMP command "x-query-virtio-vhost-queue-status".
func XQueryVirtioVhostQueueStatus(args XQueryVirtioVhostQueueStatusArgs) Command[XQueryVirtioVhostQueueStatusArgs, XQueryVirtioVhostQueueStatusResult] {
	return Command[XQueryVirtioVhostQueueStatusArgs, XQueryVirtioVhostQueueStatusResult]{name: "x-query-virtio-vhost-queue-status", Args: args}
}

// XenColoDoCheckpoint is the QMP command "xen-colo-do-checkpoint".
var XenColoDoCheckpoint = Command[Empty, Empty]{name: "xen-colo-do-checkpoint"}

// XenEventInject is the QMP command "xen-event-inject".
func XenEventInject(args XenEventInjectArgs) Command[XenEventInjectArgs, Empty] {
	return Command[XenEventInjectArgs, Empty]{name: "xen-event-inject", Args: args}
}

// XenEventList is the QMP command "xen-event-list".
var XenEventList = Command[Empty, []TypeN263]{name: "xen-event-list"}

// XenLoadDevicesState is the QMP command "xen-load-devices-state".
func XenLoadDevicesState(args XenLoadDevicesStateArgs) Command[XenLoadDevicesStateArgs, Empty] {
	return Command[XenLoadDevicesStateArgs, Empty]{name: "xen-load-devices-state", Args: args}
}

// XenSaveDevicesState is the QMP command "xen-save-devices-state".
func XenSaveDevicesState(args XenSaveDevicesStateArgs) Command[XenSaveDevicesStateArgs, Empty] {
	return Command[XenSaveDevicesStateArgs, Empty]{name: "xen-save-devices-state", Args: args}
}

// XenSetGlobalDirtyLog is the QMP command "xen-set-global-dirty-log".
func XenSetGlobalDirtyLog(args XenSetGlobalDirtyLogArgs) Command[XenSetGlobalDirtyLogArgs, Empty] {
	return Command[XenSetGlobalDirtyLogArgs, Empty]{name: "xen-set-global-dirty-log", Args: args}
}

// XenSetReplication is the QMP command "xen-set-replication".
func XenSetReplication(args XenSetReplicationArgs) Command[XenSetReplicationArgs, Empty] {
	return Command[XenSetReplicationArgs, Empty]{name: "xen-set-replication", Args: args}
}

// Yank is the QMP command "yank".
func Yank(args YankArgs) Command[YankArgs, Empty] {
	return Command[YankArgs, Empty]{name: "yank", Args: args}
}
