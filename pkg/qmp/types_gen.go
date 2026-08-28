// Code generated from QEMU query-qmp-schema. DO NOT EDIT.
package qmp

import "encoding/json"

// ACPIDEVICEOSTEvent is QAPI object 267.
type ACPIDEVICEOSTEvent struct {
	Info ACPIDEVICEOSTEventInfo `json:"info"`
}

// ACPIDEVICEOSTEventInfo is QAPI object 266.
type ACPIDEVICEOSTEventInfo struct {
	Device   *string                        `json:"device,omitempty"`
	Slot     string                         `json:"slot"`
	SlotType ACPIDEVICEOSTEventInfoSlotType `json:"slot-type"`
	Source   int64                          `json:"source"`
	Status   int64                          `json:"status"`
}

// AddClientArgs is QAPI object 240.
type AddClientArgs struct {
	Protocol string `json:"protocol"`
	Fdname   string `json:"fdname"`
	Skipauth *bool  `json:"skipauth,omitempty"`
	Tls      *bool  `json:"tls,omitempty"`
}

// AddFdArgs is QAPI object 247.
type AddFdArgs struct {
	FdsetId *int64  `json:"fdset-id,omitempty"`
	Opaque  *string `json:"opaque,omitempty"`
}

// AddFdResult is QAPI object 248.
type AddFdResult struct {
	FdsetId int64 `json:"fdset-id"`
	Fd      int64 `json:"fd"`
}

// AnnounceSelfArgs is QAPI object 111.
type AnnounceSelfArgs struct {
	Initial    int64    `json:"initial"`
	Max        int64    `json:"max"`
	Rounds     int64    `json:"rounds"`
	Step       int64    `json:"step"`
	Interfaces []string `json:"interfaces,omitempty"`
	Id         *string  `json:"id,omitempty"`
}

// BALLOONCHANGEEvent is QAPI object 216.
type BALLOONCHANGEEvent struct {
	Actual int64 `json:"actual"`
}

// BLOCKEXPORTDELETEDEvent is QAPI object 89.
type BLOCKEXPORTDELETEDEvent struct {
	Id string `json:"id"`
}

// BLOCKIMAGECORRUPTEDEvent is QAPI object 68.
type BLOCKIMAGECORRUPTEDEvent struct {
	Device   string  `json:"device"`
	NodeName *string `json:"node-name,omitempty"`
	Msg      string  `json:"msg"`
	Offset   *int64  `json:"offset,omitempty"`
	Size     *int64  `json:"size,omitempty"`
	Fatal    bool    `json:"fatal"`
}

// BLOCKIOERROREvent is QAPI object 69.
type BLOCKIOERROREvent struct {
	QomPath   string                     `json:"qom-path"`
	Device    string                     `json:"device"`
	NodeName  *string                    `json:"node-name,omitempty"`
	Operation BLOCKIOERROREventOperation `json:"operation"`
	Action    BLOCKIOERROREventAction    `json:"action"`
	Nospace   *bool                      `json:"nospace,omitempty"`
	Reason    string                     `json:"reason"`
}

// BLOCKJOBCANCELLEDEvent is QAPI object 71.
type BLOCKJOBCANCELLEDEvent struct {
	Type_  BlockJobChangeArgsType_ `json:"type"`
	Device string                  `json:"device"`
	Len    int64                   `json:"len"`
	Offset int64                   `json:"offset"`
	Speed  int64                   `json:"speed"`
}

// BLOCKJOBCOMPLETEDEvent is QAPI object 70.
type BLOCKJOBCOMPLETEDEvent struct {
	Type_  BlockJobChangeArgsType_ `json:"type"`
	Device string                  `json:"device"`
	Len    int64                   `json:"len"`
	Offset int64                   `json:"offset"`
	Speed  int64                   `json:"speed"`
	Error  *string                 `json:"error,omitempty"`
}

// BLOCKJOBERROREvent is QAPI object 72.
type BLOCKJOBERROREvent struct {
	Device    string                     `json:"device"`
	Operation BLOCKIOERROREventOperation `json:"operation"`
	Action    BLOCKIOERROREventAction    `json:"action"`
}

// BLOCKJOBPENDINGEvent is QAPI object 74.
type BLOCKJOBPENDINGEvent struct {
	Type_ BlockJobChangeArgsType_ `json:"type"`
	Id    string                  `json:"id"`
}

// BLOCKJOBREADYEvent is QAPI object 73.
type BLOCKJOBREADYEvent struct {
	Type_  BlockJobChangeArgsType_ `json:"type"`
	Device string                  `json:"device"`
	Len    int64                   `json:"len"`
	Offset int64                   `json:"offset"`
	Speed  int64                   `json:"speed"`
}

// BLOCKWRITETHRESHOLDEvent is QAPI object 75.
type BLOCKWRITETHRESHOLDEvent struct {
	NodeName       string `json:"node-name"`
	AmountExceeded int64  `json:"amount-exceeded"`
	WriteThreshold int64  `json:"write-threshold"`
}

// BalloonArgs is QAPI object 214.
type BalloonArgs struct {
	Value int64 `json:"value"`
}

// BlockCommitArgs is QAPI object 41.
type BlockCommitArgs struct {
	JobId               *string                 `json:"job-id,omitempty"`
	Device              string                  `json:"device"`
	BaseNode            *string                 `json:"base-node,omitempty"`
	Base                *string                 `json:"base,omitempty"`
	TopNode             *string                 `json:"top-node,omitempty"`
	Top                 *string                 `json:"top,omitempty"`
	BackingFile         *string                 `json:"backing-file,omitempty"`
	BackingMaskProtocol *bool                   `json:"backing-mask-protocol,omitempty"`
	Speed               *int64                  `json:"speed,omitempty"`
	OnError             *BlockCommitArgsOnError `json:"on-error,omitempty"`
	FilterNodeName      *string                 `json:"filter-node-name,omitempty"`
	AutoFinalize        *bool                   `json:"auto-finalize,omitempty"`
	AutoDismiss         *bool                   `json:"auto-dismiss,omitempty"`
}

// BlockDirtyBitmapAddArgs is QAPI object 48.
type BlockDirtyBitmapAddArgs struct {
	Node        string `json:"node"`
	Name        string `json:"name"`
	Granularity *int64 `json:"granularity,omitempty"`
	Persistent  *bool  `json:"persistent,omitempty"`
	Disabled    *bool  `json:"disabled,omitempty"`
}

// BlockDirtyBitmapMergeArgs is QAPI object 50.
type BlockDirtyBitmapMergeArgs struct {
	Node    string     `json:"node"`
	Target  string     `json:"target"`
	Bitmaps []TypeN326 `json:"bitmaps"`
}

// BlockDirtyBitmapRemoveArgs is QAPI object 49.
type BlockDirtyBitmapRemoveArgs struct {
	Node string `json:"node"`
	Name string `json:"name"`
}

// BlockExportAddArgs is QAPI object 87.
type BlockExportAddArgs struct {
	Type_            BlockExportAddArgsType_           `json:"type"`
	Id               string                            `json:"id"`
	FixedIothread    *bool                             `json:"fixed-iothread,omitempty"`
	Iothread         *BlockExportAddArgsIothread       `json:"iothread,omitempty"`
	NodeName         string                            `json:"node-name"`
	Writable         *bool                             `json:"writable,omitempty"`
	Writethrough     *bool                             `json:"writethrough,omitempty"`
	AllowInactive    *bool                             `json:"allow-inactive,omitempty"`
	Name             *string                           `json:"name,omitempty"`
	Description      *string                           `json:"description,omitempty"`
	Bitmaps          []TypeN326                        `json:"bitmaps,omitempty"`
	AllocationDepth  *bool                             `json:"allocation-depth,omitempty"`
	Addr             *NETDEVSTREAMCONNECTEDEventAddr   `json:"addr,omitempty"`
	LogicalBlockSize *int64                            `json:"logical-block-size,omitempty"`
	NumQueues        *int64                            `json:"num-queues,omitempty"`
	Mountpoint       *string                           `json:"mountpoint,omitempty"`
	Growable         *bool                             `json:"growable,omitempty"`
	AllowOther       *BlockExportAddArgsFuseAllowOther `json:"allow-other,omitempty"`
	QueueSize        *int64                            `json:"queue-size,omitempty"`
	Serial           *string                           `json:"serial,omitempty"`
}

// BlockExportAddArgsFuse is QAPI object 377.
type BlockExportAddArgsFuse struct {
	Mountpoint string                            `json:"mountpoint"`
	Growable   *bool                             `json:"growable,omitempty"`
	AllowOther *BlockExportAddArgsFuseAllowOther `json:"allow-other,omitempty"`
}

// BlockExportAddArgsNbd is QAPI object 375.
type BlockExportAddArgsNbd struct {
	Name            *string    `json:"name,omitempty"`
	Description     *string    `json:"description,omitempty"`
	Bitmaps         []TypeN326 `json:"bitmaps,omitempty"`
	AllocationDepth *bool      `json:"allocation-depth,omitempty"`
}

// BlockExportAddArgsVduseBlk is QAPI object 378.
type BlockExportAddArgsVduseBlk struct {
	Name             string  `json:"name"`
	NumQueues        *int64  `json:"num-queues,omitempty"`
	QueueSize        *int64  `json:"queue-size,omitempty"`
	LogicalBlockSize *int64  `json:"logical-block-size,omitempty"`
	Serial           *string `json:"serial,omitempty"`
}

// BlockExportAddArgsVhostUserBlk is QAPI object 376.
type BlockExportAddArgsVhostUserBlk struct {
	Addr             NETDEVSTREAMCONNECTEDEventAddr `json:"addr"`
	LogicalBlockSize *int64                         `json:"logical-block-size,omitempty"`
	NumQueues        *int64                         `json:"num-queues,omitempty"`
}

// BlockExportDelArgs is QAPI object 88.
type BlockExportDelArgs struct {
	Id   string                   `json:"id"`
	Mode *NbdServerRemoveArgsMode `json:"mode,omitempty"`
}

// BlockJobCancelArgs is QAPI object 55.
type BlockJobCancelArgs struct {
	Device string `json:"device"`
	Force  *bool  `json:"force,omitempty"`
}

// BlockJobChangeArgs is QAPI object 61.
type BlockJobChangeArgs struct {
	Id       string                   `json:"id"`
	Type_    BlockJobChangeArgsType_  `json:"type"`
	CopyMode *DriveMirrorArgsCopyMode `json:"copy-mode,omitempty"`
}

// BlockJobChangeArgsMirror is QAPI object 327.
type BlockJobChangeArgsMirror struct {
	CopyMode DriveMirrorArgsCopyMode `json:"copy-mode"`
}

// BlockJobCompleteArgs is QAPI object 58.
type BlockJobCompleteArgs struct {
	Device string `json:"device"`
}

// BlockJobDismissArgs is QAPI object 59.
type BlockJobDismissArgs struct {
	Id string `json:"id"`
}

// BlockJobFinalizeArgs is QAPI object 60.
type BlockJobFinalizeArgs struct {
	Id string `json:"id"`
}

// BlockJobPauseArgs is QAPI object 56.
type BlockJobPauseArgs struct {
	Device string `json:"device"`
}

// BlockJobResumeArgs is QAPI object 57.
type BlockJobResumeArgs struct {
	Device string `json:"device"`
}

// BlockJobSetSpeedArgs is QAPI object 54.
type BlockJobSetSpeedArgs struct {
	Device string `json:"device"`
	Speed  int64  `json:"speed"`
}

// BlockLatencyHistogramSetArgs is QAPI object 31.
type BlockLatencyHistogramSetArgs struct {
	Id              string  `json:"id"`
	Boundaries      []int64 `json:"boundaries,omitempty"`
	BoundariesRead  []int64 `json:"boundaries-read,omitempty"`
	BoundariesWrite []int64 `json:"boundaries-write,omitempty"`
	BoundariesZap   []int64 `json:"boundaries-zap,omitempty"`
	BoundariesFlush []int64 `json:"boundaries-flush,omitempty"`
}

// BlockResizeArgs is QAPI object 37.
type BlockResizeArgs struct {
	Device   *string `json:"device,omitempty"`
	NodeName *string `json:"node-name,omitempty"`
	Size     int64   `json:"size"`
}

// BlockSetIoThrottleArgs is QAPI object 30.
type BlockSetIoThrottleArgs struct {
	Device          *string `json:"device,omitempty"`
	Id              *string `json:"id,omitempty"`
	Bps             int64   `json:"bps"`
	BpsRd           int64   `json:"bps_rd"`
	BpsWr           int64   `json:"bps_wr"`
	Iops            int64   `json:"iops"`
	IopsRd          int64   `json:"iops_rd"`
	IopsWr          int64   `json:"iops_wr"`
	BpsMax          *int64  `json:"bps_max,omitempty"`
	BpsRdMax        *int64  `json:"bps_rd_max,omitempty"`
	BpsWrMax        *int64  `json:"bps_wr_max,omitempty"`
	IopsMax         *int64  `json:"iops_max,omitempty"`
	IopsRdMax       *int64  `json:"iops_rd_max,omitempty"`
	IopsWrMax       *int64  `json:"iops_wr_max,omitempty"`
	BpsMaxLength    *int64  `json:"bps_max_length,omitempty"`
	BpsRdMaxLength  *int64  `json:"bps_rd_max_length,omitempty"`
	BpsWrMaxLength  *int64  `json:"bps_wr_max_length,omitempty"`
	IopsMaxLength   *int64  `json:"iops_max_length,omitempty"`
	IopsRdMaxLength *int64  `json:"iops_rd_max_length,omitempty"`
	IopsWrMaxLength *int64  `json:"iops_wr_max_length,omitempty"`
	IopsSize        *int64  `json:"iops_size,omitempty"`
	Group           *string `json:"group,omitempty"`
}

// BlockSetWriteThresholdArgs is QAPI object 76.
type BlockSetWriteThresholdArgs struct {
	NodeName       string `json:"node-name"`
	WriteThreshold int64  `json:"write-threshold"`
}

// BlockStreamArgs is QAPI object 53.
type BlockStreamArgs struct {
	JobId               *string                 `json:"job-id,omitempty"`
	Device              string                  `json:"device"`
	Base                *string                 `json:"base,omitempty"`
	BaseNode            *string                 `json:"base-node,omitempty"`
	BackingFile         *string                 `json:"backing-file,omitempty"`
	BackingMaskProtocol *bool                   `json:"backing-mask-protocol,omitempty"`
	Bottom              *string                 `json:"bottom,omitempty"`
	Speed               *int64                  `json:"speed,omitempty"`
	OnError             *BlockCommitArgsOnError `json:"on-error,omitempty"`
	FilterNodeName      *string                 `json:"filter-node-name,omitempty"`
	AutoFinalize        *bool                   `json:"auto-finalize,omitempty"`
	AutoDismiss         *bool                   `json:"auto-dismiss,omitempty"`
}

// BlockdevAddArgs is QAPI object 62.
type BlockdevAddArgs struct {
	Driver                 BlockdevAddArgsDriver             `json:"driver"`
	NodeName               *string                           `json:"node-name,omitempty"`
	Discard                *BlockdevAddArgsDiscard           `json:"discard,omitempty"`
	Cache                  *BlockdevAddArgsCache             `json:"cache,omitempty"`
	Active                 *bool                             `json:"active,omitempty"`
	ReadOnly               *bool                             `json:"read-only,omitempty"`
	AutoReadOnly           *bool                             `json:"auto-read-only,omitempty"`
	ForceShare             *bool                             `json:"force-share,omitempty"`
	DetectZeroes           *BlockdevAddArgsDetectZeroes      `json:"detect-zeroes,omitempty"`
	Image                  any                               `json:"image,omitempty"`
	Config                 *string                           `json:"config,omitempty"`
	Align                  *int64                            `json:"align,omitempty"`
	MaxTransfer            *int64                            `json:"max-transfer,omitempty"`
	OptWriteZero           *int64                            `json:"opt-write-zero,omitempty"`
	MaxWriteZero           *int64                            `json:"max-write-zero,omitempty"`
	OptDiscard             *int64                            `json:"opt-discard,omitempty"`
	MaxDiscard             *int64                            `json:"max-discard,omitempty"`
	InjectError            []TypeN605                        `json:"inject-error,omitempty"`
	SetState               []TypeN606                        `json:"set-state,omitempty"`
	TakeChildPerms         []TypeN603                        `json:"take-child-perms,omitempty"`
	UnshareChildPerms      []TypeN603                        `json:"unshare-child-perms,omitempty"`
	File                   *BlockdevAddArgsBlkdebugImage     `json:"file,omitempty"`
	Log                    *BlockdevAddArgsBlkdebugImage     `json:"log,omitempty"`
	LogSectorSize          *int64                            `json:"log-sector-size,omitempty"`
	LogAppend              *bool                             `json:"log-append,omitempty"`
	LogSuperUpdateInterval *int64                            `json:"log-super-update-interval,omitempty"`
	Test                   *BlockdevAddArgsBlkdebugImage     `json:"test,omitempty"`
	Raw                    *BlockdevAddArgsBlkdebugImage     `json:"raw,omitempty"`
	Target                 any                               `json:"target,omitempty"`
	Bitmap                 *BlockDirtyBitmapRemoveArgs       `json:"bitmap,omitempty"`
	OnCbwError             *DriveBackupArgsOnCbwError        `json:"on-cbw-error,omitempty"`
	CbwTimeout             *int64                            `json:"cbw-timeout,omitempty"`
	MinClusterSize         *int64                            `json:"min-cluster-size,omitempty"`
	Bottom                 *string                           `json:"bottom,omitempty"`
	Filename               *string                           `json:"filename,omitempty"`
	PrManager              *string                           `json:"pr-manager,omitempty"`
	Locking                *BlockdevAddArgsFileLocking       `json:"locking,omitempty"`
	Aio                    *BlockdevAddArgsFileAio           `json:"aio,omitempty"`
	AioMaxBatch            *int64                            `json:"aio-max-batch,omitempty"`
	DropCache              *bool                             `json:"drop-cache,omitempty"`
	XCheckCacheDropped     *bool                             `json:"x-check-cache-dropped,omitempty"`
	Url                    *string                           `json:"url,omitempty"`
	Readahead              *int64                            `json:"readahead,omitempty"`
	Timeout                *int64                            `json:"timeout,omitempty"`
	Username               *string                           `json:"username,omitempty"`
	PasswordSecret         *string                           `json:"password-secret,omitempty"`
	ProxyUsername          *string                           `json:"proxy-username,omitempty"`
	ProxyPasswordSecret    *string                           `json:"proxy-password-secret,omitempty"`
	Sslverify              *bool                             `json:"sslverify,omitempty"`
	Cookie                 *string                           `json:"cookie,omitempty"`
	CookieSecret           *string                           `json:"cookie-secret,omitempty"`
	ForceRange             *bool                             `json:"force-range,omitempty"`
	Transport              *BlockdevAddArgsIscsiTransport    `json:"transport,omitempty"`
	Portal                 *string                           `json:"portal,omitempty"`
	Lun                    *int64                            `json:"lun,omitempty"`
	User                   any                               `json:"user,omitempty"`
	InitiatorName          *string                           `json:"initiator-name,omitempty"`
	HeaderDigest           *BlockdevAddArgsIscsiHeaderDigest `json:"header-digest,omitempty"`
	KeySecret              *string                           `json:"key-secret,omitempty"`
	Header                 *BlockdevAddArgsBlkdebugImage     `json:"header,omitempty"`
	Server                 any                               `json:"server,omitempty"`
	Export                 *string                           `json:"export,omitempty"`
	TlsCreds               *string                           `json:"tls-creds,omitempty"`
	TlsHostname            *string                           `json:"tls-hostname,omitempty"`
	XDirtyBitmap           *string                           `json:"x-dirty-bitmap,omitempty"`
	ReconnectDelay         *int64                            `json:"reconnect-delay,omitempty"`
	OpenTimeout            *int64                            `json:"open-timeout,omitempty"`
	Path                   *string                           `json:"path,omitempty"`
	Group                  *int64                            `json:"group,omitempty"`
	TcpSynCount            *int64                            `json:"tcp-syn-count,omitempty"`
	ReadaheadSize          *int64                            `json:"readahead-size,omitempty"`
	PageCacheSize          *int64                            `json:"page-cache-size,omitempty"`
	Debug                  *int64                            `json:"debug,omitempty"`
	Size                   *int64                            `json:"size,omitempty"`
	LatencyNs              *int64                            `json:"latency-ns,omitempty"`
	ReadZeroes             *bool                             `json:"read-zeroes,omitempty"`
	Device                 *string                           `json:"device,omitempty"`
	Namespace              any                               `json:"namespace,omitempty"`
	PreallocAlign          *int64                            `json:"prealloc-align,omitempty"`
	PreallocSize           *int64                            `json:"prealloc-size,omitempty"`
	Backing                *BlockdevAddArgsQcow2Backing      `json:"backing,omitempty"`
	LazyRefcounts          *bool                             `json:"lazy-refcounts,omitempty"`
	PassDiscardRequest     *bool                             `json:"pass-discard-request,omitempty"`
	PassDiscardSnapshot    *bool                             `json:"pass-discard-snapshot,omitempty"`
	PassDiscardOther       *bool                             `json:"pass-discard-other,omitempty"`
	DiscardNoUnref         *bool                             `json:"discard-no-unref,omitempty"`
	OverlapCheck           *BlockdevAddArgsQcow2OverlapCheck `json:"overlap-check,omitempty"`
	CacheSize              *int64                            `json:"cache-size,omitempty"`
	L2CacheSize            *int64                            `json:"l2-cache-size,omitempty"`
	L2CacheEntrySize       *int64                            `json:"l2-cache-entry-size,omitempty"`
	RefcountCacheSize      *int64                            `json:"refcount-cache-size,omitempty"`
	CacheCleanInterval     *int64                            `json:"cache-clean-interval,omitempty"`
	Encrypt                any                               `json:"encrypt,omitempty"`
	DataFile               *BlockdevAddArgsBlkdebugImage     `json:"data-file,omitempty"`
	Blkverify              *bool                             `json:"blkverify,omitempty"`
	Children               []BlockdevAddArgsBlkdebugImage    `json:"children,omitempty"`
	VoteThreshold          *int64                            `json:"vote-threshold,omitempty"`
	RewriteCorrupted       *bool                             `json:"rewrite-corrupted,omitempty"`
	ReadPattern            *BlockdevAddArgsQuorumReadPattern `json:"read-pattern,omitempty"`
	Offset                 *int64                            `json:"offset,omitempty"`
	Pool                   *string                           `json:"pool,omitempty"`
	Conf                   *string                           `json:"conf,omitempty"`
	Snapshot               *string                           `json:"snapshot,omitempty"`
	AuthClientRequired     []TypeN618                        `json:"auth-client-required,omitempty"`
	Mode                   *BlockdevAddArgsReplicationMode   `json:"mode,omitempty"`
	TopId                  *string                           `json:"top-id,omitempty"`
	HostKeyCheck           *BlockdevAddArgsSshHostKeyCheck   `json:"host-key-check,omitempty"`
	ThrottleGroup          *string                           `json:"throttle-group,omitempty"`
	Dir                    *string                           `json:"dir,omitempty"`
	FatType                *int64                            `json:"fat-type,omitempty"`
	Floppy                 *bool                             `json:"floppy,omitempty"`
	Label                  *string                           `json:"label,omitempty"`
	Rw                     *bool                             `json:"rw,omitempty"`
}

// BlockdevAddArgsBlkdebug is QAPI object 331.
type BlockdevAddArgsBlkdebug struct {
	Image             BlockdevAddArgsBlkdebugImage `json:"image"`
	Config            *string                      `json:"config,omitempty"`
	Align             *int64                       `json:"align,omitempty"`
	MaxTransfer       *int64                       `json:"max-transfer,omitempty"`
	OptWriteZero      *int64                       `json:"opt-write-zero,omitempty"`
	MaxWriteZero      *int64                       `json:"max-write-zero,omitempty"`
	OptDiscard        *int64                       `json:"opt-discard,omitempty"`
	MaxDiscard        *int64                       `json:"max-discard,omitempty"`
	InjectError       []TypeN605                   `json:"inject-error,omitempty"`
	SetState          []TypeN606                   `json:"set-state,omitempty"`
	TakeChildPerms    []TypeN603                   `json:"take-child-perms,omitempty"`
	UnshareChildPerms []TypeN603                   `json:"unshare-child-perms,omitempty"`
}

// BlockdevAddArgsBlklogwrites is QAPI object 332.
type BlockdevAddArgsBlklogwrites struct {
	File                   BlockdevAddArgsBlkdebugImage `json:"file"`
	Log                    BlockdevAddArgsBlkdebugImage `json:"log"`
	LogSectorSize          *int64                       `json:"log-sector-size,omitempty"`
	LogAppend              *bool                        `json:"log-append,omitempty"`
	LogSuperUpdateInterval *int64                       `json:"log-super-update-interval,omitempty"`
}

// BlockdevAddArgsBlkreplay is QAPI object 334.
type BlockdevAddArgsBlkreplay struct {
	Image BlockdevAddArgsBlkdebugImage `json:"image"`
}

// BlockdevAddArgsBlkverify is QAPI object 333.
type BlockdevAddArgsBlkverify struct {
	Test BlockdevAddArgsBlkdebugImage `json:"test"`
	Raw  BlockdevAddArgsBlkdebugImage `json:"raw"`
}

// BlockdevAddArgsBochs is QAPI object 335.
type BlockdevAddArgsBochs struct {
	File BlockdevAddArgsBlkdebugImage `json:"file"`
}

// BlockdevAddArgsCache is QAPI object 330.
type BlockdevAddArgsCache struct {
	Direct  *bool `json:"direct,omitempty"`
	NoFlush *bool `json:"no-flush,omitempty"`
}

// BlockdevAddArgsCopyBeforeWrite is QAPI object 336.
type BlockdevAddArgsCopyBeforeWrite struct {
	File           BlockdevAddArgsBlkdebugImage `json:"file"`
	Target         BlockdevAddArgsBlkdebugImage `json:"target"`
	Bitmap         *BlockDirtyBitmapRemoveArgs  `json:"bitmap,omitempty"`
	OnCbwError     *DriveBackupArgsOnCbwError   `json:"on-cbw-error,omitempty"`
	CbwTimeout     *int64                       `json:"cbw-timeout,omitempty"`
	MinClusterSize *int64                       `json:"min-cluster-size,omitempty"`
}

// BlockdevAddArgsCopyOnRead is QAPI object 337.
type BlockdevAddArgsCopyOnRead struct {
	File   BlockdevAddArgsBlkdebugImage `json:"file"`
	Bottom *string                      `json:"bottom,omitempty"`
}

// BlockdevAddArgsFile is QAPI object 338.
type BlockdevAddArgsFile struct {
	Filename           string                      `json:"filename"`
	PrManager          *string                     `json:"pr-manager,omitempty"`
	Locking            *BlockdevAddArgsFileLocking `json:"locking,omitempty"`
	Aio                *BlockdevAddArgsFileAio     `json:"aio,omitempty"`
	AioMaxBatch        *int64                      `json:"aio-max-batch,omitempty"`
	DropCache          *bool                       `json:"drop-cache,omitempty"`
	XCheckCacheDropped *bool                       `json:"x-check-cache-dropped,omitempty"`
}

// BlockdevAddArgsFtp is QAPI object 339.
type BlockdevAddArgsFtp struct {
	Url                 string  `json:"url"`
	Readahead           *int64  `json:"readahead,omitempty"`
	Timeout             *int64  `json:"timeout,omitempty"`
	Username            *string `json:"username,omitempty"`
	PasswordSecret      *string `json:"password-secret,omitempty"`
	ProxyUsername       *string `json:"proxy-username,omitempty"`
	ProxyPasswordSecret *string `json:"proxy-password-secret,omitempty"`
}

// BlockdevAddArgsFtps is QAPI object 340.
type BlockdevAddArgsFtps struct {
	Url                 string  `json:"url"`
	Readahead           *int64  `json:"readahead,omitempty"`
	Timeout             *int64  `json:"timeout,omitempty"`
	Username            *string `json:"username,omitempty"`
	PasswordSecret      *string `json:"password-secret,omitempty"`
	ProxyUsername       *string `json:"proxy-username,omitempty"`
	ProxyPasswordSecret *string `json:"proxy-password-secret,omitempty"`
	Sslverify           *bool   `json:"sslverify,omitempty"`
}

// BlockdevAddArgsHttp is QAPI object 341.
type BlockdevAddArgsHttp struct {
	Url                 string  `json:"url"`
	Readahead           *int64  `json:"readahead,omitempty"`
	Timeout             *int64  `json:"timeout,omitempty"`
	Username            *string `json:"username,omitempty"`
	PasswordSecret      *string `json:"password-secret,omitempty"`
	ProxyUsername       *string `json:"proxy-username,omitempty"`
	ProxyPasswordSecret *string `json:"proxy-password-secret,omitempty"`
	Cookie              *string `json:"cookie,omitempty"`
	CookieSecret        *string `json:"cookie-secret,omitempty"`
	ForceRange          *bool   `json:"force-range,omitempty"`
}

// BlockdevAddArgsHttps is QAPI object 342.
type BlockdevAddArgsHttps struct {
	Url                 string  `json:"url"`
	Readahead           *int64  `json:"readahead,omitempty"`
	Timeout             *int64  `json:"timeout,omitempty"`
	Username            *string `json:"username,omitempty"`
	PasswordSecret      *string `json:"password-secret,omitempty"`
	ProxyUsername       *string `json:"proxy-username,omitempty"`
	ProxyPasswordSecret *string `json:"proxy-password-secret,omitempty"`
	Cookie              *string `json:"cookie,omitempty"`
	CookieSecret        *string `json:"cookie-secret,omitempty"`
	ForceRange          *bool   `json:"force-range,omitempty"`
	Sslverify           *bool   `json:"sslverify,omitempty"`
}

// BlockdevAddArgsIscsi is QAPI object 344.
type BlockdevAddArgsIscsi struct {
	Transport      BlockdevAddArgsIscsiTransport     `json:"transport"`
	Portal         string                            `json:"portal"`
	Target         string                            `json:"target"`
	Lun            *int64                            `json:"lun,omitempty"`
	User           *string                           `json:"user,omitempty"`
	PasswordSecret *string                           `json:"password-secret,omitempty"`
	InitiatorName  *string                           `json:"initiator-name,omitempty"`
	HeaderDigest   *BlockdevAddArgsIscsiHeaderDigest `json:"header-digest,omitempty"`
	Timeout        *int64                            `json:"timeout,omitempty"`
}

// BlockdevAddArgsLuks is QAPI object 345.
type BlockdevAddArgsLuks struct {
	File      BlockdevAddArgsBlkdebugImage  `json:"file"`
	KeySecret *string                       `json:"key-secret,omitempty"`
	Header    *BlockdevAddArgsBlkdebugImage `json:"header,omitempty"`
}

// BlockdevAddArgsNbd is QAPI object 346.
type BlockdevAddArgsNbd struct {
	Server         NETDEVSTREAMCONNECTEDEventAddr `json:"server"`
	Export         *string                        `json:"export,omitempty"`
	TlsCreds       *string                        `json:"tls-creds,omitempty"`
	TlsHostname    *string                        `json:"tls-hostname,omitempty"`
	XDirtyBitmap   *string                        `json:"x-dirty-bitmap,omitempty"`
	ReconnectDelay *int64                         `json:"reconnect-delay,omitempty"`
	OpenTimeout    *int64                         `json:"open-timeout,omitempty"`
}

// BlockdevAddArgsNfs is QAPI object 347.
type BlockdevAddArgsNfs struct {
	Server        BlockdevAddArgsNfsServer `json:"server"`
	Path          string                   `json:"path"`
	User          *int64                   `json:"user,omitempty"`
	Group         *int64                   `json:"group,omitempty"`
	TcpSynCount   *int64                   `json:"tcp-syn-count,omitempty"`
	ReadaheadSize *int64                   `json:"readahead-size,omitempty"`
	PageCacheSize *int64                   `json:"page-cache-size,omitempty"`
	Debug         *int64                   `json:"debug,omitempty"`
}

// BlockdevAddArgsNfsServer is QAPI object 611.
type BlockdevAddArgsNfsServer struct {
	Type_ BlockdevAddArgsNfsServerType_ `json:"type"`
	Host  string                        `json:"host"`
}

// BlockdevAddArgsNullAio is QAPI object 348.
type BlockdevAddArgsNullAio struct {
	Size       *int64 `json:"size,omitempty"`
	LatencyNs  *int64 `json:"latency-ns,omitempty"`
	ReadZeroes *bool  `json:"read-zeroes,omitempty"`
}

// BlockdevAddArgsNvme is QAPI object 349.
type BlockdevAddArgsNvme struct {
	Device    string `json:"device"`
	Namespace int64  `json:"namespace"`
}

// BlockdevAddArgsPreallocate is QAPI object 351.
type BlockdevAddArgsPreallocate struct {
	File          BlockdevAddArgsBlkdebugImage `json:"file"`
	PreallocAlign *int64                       `json:"prealloc-align,omitempty"`
	PreallocSize  *int64                       `json:"prealloc-size,omitempty"`
}

// BlockdevAddArgsQcow is QAPI object 353.
type BlockdevAddArgsQcow struct {
	File    BlockdevAddArgsBlkdebugImage `json:"file"`
	Backing *BlockdevAddArgsQcow2Backing `json:"backing,omitempty"`
	Encrypt *BlockdevAddArgsQcowEncrypt  `json:"encrypt,omitempty"`
}

// BlockdevAddArgsQcow2 is QAPI object 352.
type BlockdevAddArgsQcow2 struct {
	File                BlockdevAddArgsBlkdebugImage      `json:"file"`
	Backing             *BlockdevAddArgsQcow2Backing      `json:"backing,omitempty"`
	LazyRefcounts       *bool                             `json:"lazy-refcounts,omitempty"`
	PassDiscardRequest  *bool                             `json:"pass-discard-request,omitempty"`
	PassDiscardSnapshot *bool                             `json:"pass-discard-snapshot,omitempty"`
	PassDiscardOther    *bool                             `json:"pass-discard-other,omitempty"`
	DiscardNoUnref      *bool                             `json:"discard-no-unref,omitempty"`
	OverlapCheck        *BlockdevAddArgsQcow2OverlapCheck `json:"overlap-check,omitempty"`
	CacheSize           *int64                            `json:"cache-size,omitempty"`
	L2CacheSize         *int64                            `json:"l2-cache-size,omitempty"`
	L2CacheEntrySize    *int64                            `json:"l2-cache-entry-size,omitempty"`
	RefcountCacheSize   *int64                            `json:"refcount-cache-size,omitempty"`
	CacheCleanInterval  *int64                            `json:"cache-clean-interval,omitempty"`
	Encrypt             *BlockdevAddArgsQcow2Encrypt      `json:"encrypt,omitempty"`
	DataFile            *BlockdevAddArgsBlkdebugImage     `json:"data-file,omitempty"`
}

// BlockdevAddArgsQcow2Encrypt is QAPI object 614.
type BlockdevAddArgsQcow2Encrypt struct {
	Format    BlockdevAddArgsQcow2EncryptFormat `json:"format"`
	KeySecret *string                           `json:"key-secret,omitempty"`
}

// BlockdevAddArgsQcow2EncryptAes is QAPI object 752.
type BlockdevAddArgsQcow2EncryptAes struct {
	KeySecret *string `json:"key-secret,omitempty"`
}

// BlockdevAddArgsQcow2EncryptLuks is QAPI object 753.
type BlockdevAddArgsQcow2EncryptLuks struct {
	KeySecret *string `json:"key-secret,omitempty"`
}

// BlockdevAddArgsQcow2OverlapCheckAlt0 is QAPI object 749.
type BlockdevAddArgsQcow2OverlapCheckAlt0 struct {
	Template        *BlockdevAddArgsQcow2OverlapCheckAlt1 `json:"template,omitempty"`
	MainHeader      *bool                                 `json:"main-header,omitempty"`
	ActiveL1        *bool                                 `json:"active-l1,omitempty"`
	ActiveL2        *bool                                 `json:"active-l2,omitempty"`
	RefcountTable   *bool                                 `json:"refcount-table,omitempty"`
	RefcountBlock   *bool                                 `json:"refcount-block,omitempty"`
	SnapshotTable   *bool                                 `json:"snapshot-table,omitempty"`
	InactiveL1      *bool                                 `json:"inactive-l1,omitempty"`
	InactiveL2      *bool                                 `json:"inactive-l2,omitempty"`
	BitmapDirectory *bool                                 `json:"bitmap-directory,omitempty"`
}

// BlockdevAddArgsQcowEncrypt is QAPI object 615.
type BlockdevAddArgsQcowEncrypt struct {
	Format    BlockdevAddArgsQcowEncryptFormat `json:"format"`
	KeySecret *string                          `json:"key-secret,omitempty"`
}

// BlockdevAddArgsQed is QAPI object 354.
type BlockdevAddArgsQed struct {
	File    BlockdevAddArgsBlkdebugImage `json:"file"`
	Backing *BlockdevAddArgsQcow2Backing `json:"backing,omitempty"`
}

// BlockdevAddArgsQuorum is QAPI object 355.
type BlockdevAddArgsQuorum struct {
	Blkverify        *bool                             `json:"blkverify,omitempty"`
	Children         []BlockdevAddArgsBlkdebugImage    `json:"children"`
	VoteThreshold    int64                             `json:"vote-threshold"`
	RewriteCorrupted *bool                             `json:"rewrite-corrupted,omitempty"`
	ReadPattern      *BlockdevAddArgsQuorumReadPattern `json:"read-pattern,omitempty"`
}

// BlockdevAddArgsRaw is QAPI object 356.
type BlockdevAddArgsRaw struct {
	File   BlockdevAddArgsBlkdebugImage `json:"file"`
	Offset *int64                       `json:"offset,omitempty"`
	Size   *int64                       `json:"size,omitempty"`
}

// BlockdevAddArgsRbd is QAPI object 357.
type BlockdevAddArgsRbd struct {
	Pool               string                     `json:"pool"`
	Namespace          *string                    `json:"namespace,omitempty"`
	Image              string                     `json:"image"`
	Conf               *string                    `json:"conf,omitempty"`
	Snapshot           *string                    `json:"snapshot,omitempty"`
	Encrypt            *BlockdevAddArgsRbdEncrypt `json:"encrypt,omitempty"`
	User               *string                    `json:"user,omitempty"`
	AuthClientRequired []TypeN618                 `json:"auth-client-required,omitempty"`
	KeySecret          *string                    `json:"key-secret,omitempty"`
	Server             []TypeN619                 `json:"server,omitempty"`
}

// BlockdevAddArgsRbdEncrypt is QAPI object 617.
type BlockdevAddArgsRbdEncrypt struct {
	Format    BlockdevAddArgsRbdEncryptFormat `json:"format"`
	Parent    *BlockdevAddArgsRbdEncrypt      `json:"parent,omitempty"`
	KeySecret *string                         `json:"key-secret,omitempty"`
}

// BlockdevAddArgsRbdEncryptLuks is QAPI object 756.
type BlockdevAddArgsRbdEncryptLuks struct {
	KeySecret string `json:"key-secret"`
}

// BlockdevAddArgsRbdEncryptLuks2 is QAPI object 757.
type BlockdevAddArgsRbdEncryptLuks2 struct {
	KeySecret string `json:"key-secret"`
}

// BlockdevAddArgsRbdEncryptLuksAny is QAPI object 758.
type BlockdevAddArgsRbdEncryptLuksAny struct {
	KeySecret string `json:"key-secret"`
}

// BlockdevAddArgsReplication is QAPI object 358.
type BlockdevAddArgsReplication struct {
	File  BlockdevAddArgsBlkdebugImage   `json:"file"`
	Mode  BlockdevAddArgsReplicationMode `json:"mode"`
	TopId *string                        `json:"top-id,omitempty"`
}

// BlockdevAddArgsSsh is QAPI object 359.
type BlockdevAddArgsSsh struct {
	Server       BlockdevAddArgsSshServer        `json:"server"`
	Path         string                          `json:"path"`
	User         *string                         `json:"user,omitempty"`
	HostKeyCheck *BlockdevAddArgsSshHostKeyCheck `json:"host-key-check,omitempty"`
}

// BlockdevAddArgsSshHostKeyCheck is QAPI object 622.
type BlockdevAddArgsSshHostKeyCheck struct {
	Mode  BlockdevAddArgsSshHostKeyCheckMode       `json:"mode"`
	Type_ *BlockdevAddArgsSshHostKeyCheckHashType_ `json:"type,omitempty"`
	Hash  *string                                  `json:"hash,omitempty"`
}

// BlockdevAddArgsSshHostKeyCheckHash is QAPI object 760.
type BlockdevAddArgsSshHostKeyCheckHash struct {
	Type_ BlockdevAddArgsSshHostKeyCheckHashType_ `json:"type"`
	Hash  string                                  `json:"hash"`
}

// BlockdevAddArgsSshServer is QAPI object 621.
type BlockdevAddArgsSshServer struct {
	Host              string `json:"host"`
	Port              string `json:"port"`
	Numeric           *bool  `json:"numeric,omitempty"`
	To                *int64 `json:"to,omitempty"`
	Ipv4              *bool  `json:"ipv4,omitempty"`
	Ipv6              *bool  `json:"ipv6,omitempty"`
	KeepAlive         *bool  `json:"keep-alive,omitempty"`
	KeepAliveCount    *int64 `json:"keep-alive-count,omitempty"`
	KeepAliveIdle     *int64 `json:"keep-alive-idle,omitempty"`
	KeepAliveInterval *int64 `json:"keep-alive-interval,omitempty"`
	Mptcp             *bool  `json:"mptcp,omitempty"`
}

// BlockdevAddArgsThrottle is QAPI object 360.
type BlockdevAddArgsThrottle struct {
	ThrottleGroup string                       `json:"throttle-group"`
	File          BlockdevAddArgsBlkdebugImage `json:"file"`
}

// BlockdevAddArgsVvfat is QAPI object 364.
type BlockdevAddArgsVvfat struct {
	Dir     string  `json:"dir"`
	FatType *int64  `json:"fat-type,omitempty"`
	Floppy  *bool   `json:"floppy,omitempty"`
	Label   *string `json:"label,omitempty"`
	Rw      *bool   `json:"rw,omitempty"`
}

// BlockdevBackupArgs is QAPI object 43.
type BlockdevBackupArgs struct {
	JobId          *string                    `json:"job-id,omitempty"`
	Device         string                     `json:"device"`
	Sync           DriveBackupArgsSync        `json:"sync"`
	Speed          *int64                     `json:"speed,omitempty"`
	Bitmap         *string                    `json:"bitmap,omitempty"`
	BitmapMode     *DriveBackupArgsBitmapMode `json:"bitmap-mode,omitempty"`
	Compress       *bool                      `json:"compress,omitempty"`
	OnSourceError  *BlockCommitArgsOnError    `json:"on-source-error,omitempty"`
	OnTargetError  *BlockCommitArgsOnError    `json:"on-target-error,omitempty"`
	OnCbwError     *DriveBackupArgsOnCbwError `json:"on-cbw-error,omitempty"`
	AutoFinalize   *bool                      `json:"auto-finalize,omitempty"`
	AutoDismiss    *bool                      `json:"auto-dismiss,omitempty"`
	FilterNodeName *string                    `json:"filter-node-name,omitempty"`
	DiscardSource  *bool                      `json:"discard-source,omitempty"`
	XPerf          *DriveBackupArgsXPerf      `json:"x-perf,omitempty"`
	Target         string                     `json:"target"`
}

// BlockdevChangeMediumArgs is QAPI object 27.
type BlockdevChangeMediumArgs struct {
	Device       *string                               `json:"device,omitempty"`
	Id           *string                               `json:"id,omitempty"`
	Filename     string                                `json:"filename"`
	Format       *string                               `json:"format,omitempty"`
	Force        *bool                                 `json:"force,omitempty"`
	ReadOnlyMode *BlockdevChangeMediumArgsReadOnlyMode `json:"read-only-mode,omitempty"`
}

// BlockdevCloseTrayArgs is QAPI object 24.
type BlockdevCloseTrayArgs struct {
	Device *string `json:"device,omitempty"`
	Id     *string `json:"id,omitempty"`
}

// BlockdevCreateArgs is QAPI object 66.
type BlockdevCreateArgs struct {
	JobId   string                    `json:"job-id"`
	Options BlockdevCreateArgsOptions `json:"options"`
}

// BlockdevCreateArgsOptions is QAPI object 365.
type BlockdevCreateArgsOptions struct {
	Driver          BlockdevAddArgsDriver                          `json:"driver"`
	Filename        *string                                        `json:"filename,omitempty"`
	Size            *int64                                         `json:"size,omitempty"`
	Preallocation   *BlockdevCreateArgsOptionsFilePreallocation    `json:"preallocation,omitempty"`
	Nocow           *bool                                          `json:"nocow,omitempty"`
	ExtentSizeHint  *int64                                         `json:"extent-size-hint,omitempty"`
	KeySecret       *string                                        `json:"key-secret,omitempty"`
	CipherAlg       *BlockdevCreateArgsOptionsLuksCipherAlg        `json:"cipher-alg,omitempty"`
	CipherMode      *BlockdevCreateArgsOptionsLuksCipherMode       `json:"cipher-mode,omitempty"`
	IvgenAlg        *BlockdevCreateArgsOptionsLuksIvgenAlg         `json:"ivgen-alg,omitempty"`
	IvgenHashAlg    *BlockdevCreateArgsOptionsLuksIvgenHashAlg     `json:"ivgen-hash-alg,omitempty"`
	HashAlg         *BlockdevCreateArgsOptionsLuksIvgenHashAlg     `json:"hash-alg,omitempty"`
	IterTime        *int64                                         `json:"iter-time,omitempty"`
	File            *BlockdevAddArgsBlkdebugImage                  `json:"file,omitempty"`
	Header          *BlockdevAddArgsBlkdebugImage                  `json:"header,omitempty"`
	Location        any                                            `json:"location,omitempty"`
	ClusterSize     *int64                                         `json:"cluster-size,omitempty"`
	BackingFile     *string                                        `json:"backing-file,omitempty"`
	Encrypt         any                                            `json:"encrypt,omitempty"`
	DataFile        *BlockdevAddArgsBlkdebugImage                  `json:"data-file,omitempty"`
	DataFileRaw     *bool                                          `json:"data-file-raw,omitempty"`
	ExtendedL2      *bool                                          `json:"extended-l2,omitempty"`
	Version         *BlockdevCreateArgsOptionsQcow2Version         `json:"version,omitempty"`
	BackingFmt      *BlockdevAddArgsDriver                         `json:"backing-fmt,omitempty"`
	LazyRefcounts   *bool                                          `json:"lazy-refcounts,omitempty"`
	RefcountBits    *int64                                         `json:"refcount-bits,omitempty"`
	CompressionType *BlockdevCreateArgsOptionsQcow2CompressionType `json:"compression-type,omitempty"`
	TableSize       *int64                                         `json:"table-size,omitempty"`
	LogSize         *int64                                         `json:"log-size,omitempty"`
	BlockSize       *int64                                         `json:"block-size,omitempty"`
	Subformat       any                                            `json:"subformat,omitempty"`
	BlockStateZero  *bool                                          `json:"block-state-zero,omitempty"`
	Extents         []BlockdevAddArgsBlkdebugImage                 `json:"extents,omitempty"`
	AdapterType     *BlockdevCreateArgsOptionsVmdkAdapterType      `json:"adapter-type,omitempty"`
	Hwversion       *string                                        `json:"hwversion,omitempty"`
	Toolsversion    *string                                        `json:"toolsversion,omitempty"`
	ZeroedGrain     *bool                                          `json:"zeroed-grain,omitempty"`
	ForceSize       *bool                                          `json:"force-size,omitempty"`
}

// BlockdevCreateArgsOptionsFile is QAPI object 623.
type BlockdevCreateArgsOptionsFile struct {
	Filename       string                                      `json:"filename"`
	Size           int64                                       `json:"size"`
	Preallocation  *BlockdevCreateArgsOptionsFilePreallocation `json:"preallocation,omitempty"`
	Nocow          *bool                                       `json:"nocow,omitempty"`
	ExtentSizeHint *int64                                      `json:"extent-size-hint,omitempty"`
}

// BlockdevCreateArgsOptionsLuks is QAPI object 624.
type BlockdevCreateArgsOptionsLuks struct {
	KeySecret     *string                                     `json:"key-secret,omitempty"`
	CipherAlg     *BlockdevCreateArgsOptionsLuksCipherAlg     `json:"cipher-alg,omitempty"`
	CipherMode    *BlockdevCreateArgsOptionsLuksCipherMode    `json:"cipher-mode,omitempty"`
	IvgenAlg      *BlockdevCreateArgsOptionsLuksIvgenAlg      `json:"ivgen-alg,omitempty"`
	IvgenHashAlg  *BlockdevCreateArgsOptionsLuksIvgenHashAlg  `json:"ivgen-hash-alg,omitempty"`
	HashAlg       *BlockdevCreateArgsOptionsLuksIvgenHashAlg  `json:"hash-alg,omitempty"`
	IterTime      *int64                                      `json:"iter-time,omitempty"`
	File          *BlockdevAddArgsBlkdebugImage               `json:"file,omitempty"`
	Header        *BlockdevAddArgsBlkdebugImage               `json:"header,omitempty"`
	Size          int64                                       `json:"size"`
	Preallocation *BlockdevCreateArgsOptionsFilePreallocation `json:"preallocation,omitempty"`
}

// BlockdevCreateArgsOptionsNfs is QAPI object 625.
type BlockdevCreateArgsOptionsNfs struct {
	Location BlockdevAddArgsNfs `json:"location"`
	Size     int64              `json:"size"`
}

// BlockdevCreateArgsOptionsParallels is QAPI object 626.
type BlockdevCreateArgsOptionsParallels struct {
	File        BlockdevAddArgsBlkdebugImage `json:"file"`
	Size        int64                        `json:"size"`
	ClusterSize *int64                       `json:"cluster-size,omitempty"`
}

// BlockdevCreateArgsOptionsQcow is QAPI object 627.
type BlockdevCreateArgsOptionsQcow struct {
	File        BlockdevAddArgsBlkdebugImage          `json:"file"`
	Size        int64                                 `json:"size"`
	BackingFile *string                               `json:"backing-file,omitempty"`
	Encrypt     *BlockdevCreateArgsOptionsQcowEncrypt `json:"encrypt,omitempty"`
}

// BlockdevCreateArgsOptionsQcow2 is QAPI object 628.
type BlockdevCreateArgsOptionsQcow2 struct {
	File            BlockdevAddArgsBlkdebugImage                   `json:"file"`
	DataFile        *BlockdevAddArgsBlkdebugImage                  `json:"data-file,omitempty"`
	DataFileRaw     *bool                                          `json:"data-file-raw,omitempty"`
	ExtendedL2      *bool                                          `json:"extended-l2,omitempty"`
	Size            int64                                          `json:"size"`
	Version         *BlockdevCreateArgsOptionsQcow2Version         `json:"version,omitempty"`
	BackingFile     *string                                        `json:"backing-file,omitempty"`
	BackingFmt      *BlockdevAddArgsDriver                         `json:"backing-fmt,omitempty"`
	Encrypt         *BlockdevCreateArgsOptionsQcowEncrypt          `json:"encrypt,omitempty"`
	ClusterSize     *int64                                         `json:"cluster-size,omitempty"`
	Preallocation   *BlockdevCreateArgsOptionsFilePreallocation    `json:"preallocation,omitempty"`
	LazyRefcounts   *bool                                          `json:"lazy-refcounts,omitempty"`
	RefcountBits    *int64                                         `json:"refcount-bits,omitempty"`
	CompressionType *BlockdevCreateArgsOptionsQcow2CompressionType `json:"compression-type,omitempty"`
}

// BlockdevCreateArgsOptionsQcowEncrypt is QAPI object 766.
type BlockdevCreateArgsOptionsQcowEncrypt struct {
	Format       BlockdevCreateArgsOptionsQcowEncryptFormat `json:"format"`
	KeySecret    *string                                    `json:"key-secret,omitempty"`
	CipherAlg    *BlockdevCreateArgsOptionsLuksCipherAlg    `json:"cipher-alg,omitempty"`
	CipherMode   *BlockdevCreateArgsOptionsLuksCipherMode   `json:"cipher-mode,omitempty"`
	IvgenAlg     *BlockdevCreateArgsOptionsLuksIvgenAlg     `json:"ivgen-alg,omitempty"`
	IvgenHashAlg *BlockdevCreateArgsOptionsLuksIvgenHashAlg `json:"ivgen-hash-alg,omitempty"`
	HashAlg      *BlockdevCreateArgsOptionsLuksIvgenHashAlg `json:"hash-alg,omitempty"`
	IterTime     *int64                                     `json:"iter-time,omitempty"`
}

// BlockdevCreateArgsOptionsQcowEncryptLuks is QAPI object 813.
type BlockdevCreateArgsOptionsQcowEncryptLuks struct {
	KeySecret    *string                                    `json:"key-secret,omitempty"`
	CipherAlg    *BlockdevCreateArgsOptionsLuksCipherAlg    `json:"cipher-alg,omitempty"`
	CipherMode   *BlockdevCreateArgsOptionsLuksCipherMode   `json:"cipher-mode,omitempty"`
	IvgenAlg     *BlockdevCreateArgsOptionsLuksIvgenAlg     `json:"ivgen-alg,omitempty"`
	IvgenHashAlg *BlockdevCreateArgsOptionsLuksIvgenHashAlg `json:"ivgen-hash-alg,omitempty"`
	HashAlg      *BlockdevCreateArgsOptionsLuksIvgenHashAlg `json:"hash-alg,omitempty"`
	IterTime     *int64                                     `json:"iter-time,omitempty"`
}

// BlockdevCreateArgsOptionsQed is QAPI object 629.
type BlockdevCreateArgsOptionsQed struct {
	File        BlockdevAddArgsBlkdebugImage `json:"file"`
	Size        int64                        `json:"size"`
	BackingFile *string                      `json:"backing-file,omitempty"`
	BackingFmt  *BlockdevAddArgsDriver       `json:"backing-fmt,omitempty"`
	ClusterSize *int64                       `json:"cluster-size,omitempty"`
	TableSize   *int64                       `json:"table-size,omitempty"`
}

// BlockdevCreateArgsOptionsRbd is QAPI object 630.
type BlockdevCreateArgsOptionsRbd struct {
	Location    BlockdevAddArgsRbd                   `json:"location"`
	Size        int64                                `json:"size"`
	ClusterSize *int64                               `json:"cluster-size,omitempty"`
	Encrypt     *BlockdevCreateArgsOptionsRbdEncrypt `json:"encrypt,omitempty"`
}

// BlockdevCreateArgsOptionsRbdEncrypt is QAPI object 769.
type BlockdevCreateArgsOptionsRbdEncrypt struct {
	Format    BlockdevAddArgsRbdEncryptFormat         `json:"format"`
	KeySecret *string                                 `json:"key-secret,omitempty"`
	CipherAlg *BlockdevCreateArgsOptionsLuksCipherAlg `json:"cipher-alg,omitempty"`
}

// BlockdevCreateArgsOptionsRbdEncryptLuks is QAPI object 814.
type BlockdevCreateArgsOptionsRbdEncryptLuks struct {
	KeySecret string                                  `json:"key-secret"`
	CipherAlg *BlockdevCreateArgsOptionsLuksCipherAlg `json:"cipher-alg,omitempty"`
}

// BlockdevCreateArgsOptionsRbdEncryptLuks2 is QAPI object 815.
type BlockdevCreateArgsOptionsRbdEncryptLuks2 struct {
	KeySecret string                                  `json:"key-secret"`
	CipherAlg *BlockdevCreateArgsOptionsLuksCipherAlg `json:"cipher-alg,omitempty"`
}

// BlockdevCreateArgsOptionsSsh is QAPI object 631.
type BlockdevCreateArgsOptionsSsh struct {
	Location BlockdevAddArgsSsh `json:"location"`
	Size     int64              `json:"size"`
}

// BlockdevCreateArgsOptionsVdi is QAPI object 632.
type BlockdevCreateArgsOptionsVdi struct {
	File          BlockdevAddArgsBlkdebugImage                `json:"file"`
	Size          int64                                       `json:"size"`
	Preallocation *BlockdevCreateArgsOptionsFilePreallocation `json:"preallocation,omitempty"`
}

// BlockdevCreateArgsOptionsVhdx is QAPI object 633.
type BlockdevCreateArgsOptionsVhdx struct {
	File           BlockdevAddArgsBlkdebugImage            `json:"file"`
	Size           int64                                   `json:"size"`
	LogSize        *int64                                  `json:"log-size,omitempty"`
	BlockSize      *int64                                  `json:"block-size,omitempty"`
	Subformat      *BlockdevCreateArgsOptionsVhdxSubformat `json:"subformat,omitempty"`
	BlockStateZero *bool                                   `json:"block-state-zero,omitempty"`
}

// BlockdevCreateArgsOptionsVmdk is QAPI object 634.
type BlockdevCreateArgsOptionsVmdk struct {
	File         BlockdevAddArgsBlkdebugImage              `json:"file"`
	Size         int64                                     `json:"size"`
	Extents      []BlockdevAddArgsBlkdebugImage            `json:"extents,omitempty"`
	Subformat    *BlockdevCreateArgsOptionsVmdkSubformat   `json:"subformat,omitempty"`
	BackingFile  *string                                   `json:"backing-file,omitempty"`
	AdapterType  *BlockdevCreateArgsOptionsVmdkAdapterType `json:"adapter-type,omitempty"`
	Hwversion    *string                                   `json:"hwversion,omitempty"`
	Toolsversion *string                                   `json:"toolsversion,omitempty"`
	ZeroedGrain  *bool                                     `json:"zeroed-grain,omitempty"`
}

// BlockdevCreateArgsOptionsVpc is QAPI object 635.
type BlockdevCreateArgsOptionsVpc struct {
	File      BlockdevAddArgsBlkdebugImage           `json:"file"`
	Size      int64                                  `json:"size"`
	Subformat *BlockdevCreateArgsOptionsVpcSubformat `json:"subformat,omitempty"`
	ForceSize *bool                                  `json:"force-size,omitempty"`
}

// BlockdevDelArgs is QAPI object 64.
type BlockdevDelArgs struct {
	NodeName string `json:"node-name"`
}

// BlockdevInsertMediumArgs is QAPI object 26.
type BlockdevInsertMediumArgs struct {
	Id       string `json:"id"`
	NodeName string `json:"node-name"`
}

// BlockdevMirrorArgs is QAPI object 52.
type BlockdevMirrorArgs struct {
	JobId          *string                  `json:"job-id,omitempty"`
	Device         string                   `json:"device"`
	Target         string                   `json:"target"`
	Replaces       *string                  `json:"replaces,omitempty"`
	Sync           DriveBackupArgsSync      `json:"sync"`
	Speed          *int64                   `json:"speed,omitempty"`
	Granularity    *int64                   `json:"granularity,omitempty"`
	BufSize        *int64                   `json:"buf-size,omitempty"`
	OnSourceError  *BlockCommitArgsOnError  `json:"on-source-error,omitempty"`
	OnTargetError  *BlockCommitArgsOnError  `json:"on-target-error,omitempty"`
	FilterNodeName *string                  `json:"filter-node-name,omitempty"`
	CopyMode       *DriveMirrorArgsCopyMode `json:"copy-mode,omitempty"`
	AutoFinalize   *bool                    `json:"auto-finalize,omitempty"`
	AutoDismiss    *bool                    `json:"auto-dismiss,omitempty"`
	TargetIsZero   *bool                    `json:"target-is-zero,omitempty"`
}

// BlockdevOpenTrayArgs is QAPI object 23.
type BlockdevOpenTrayArgs struct {
	Device *string `json:"device,omitempty"`
	Id     *string `json:"id,omitempty"`
	Force  *bool   `json:"force,omitempty"`
}

// BlockdevRemoveMediumArgs is QAPI object 25.
type BlockdevRemoveMediumArgs struct {
	Id string `json:"id"`
}

// BlockdevReopenArgs is QAPI object 63.
type BlockdevReopenArgs struct {
	Options []BlockdevAddArgs `json:"options"`
}

// BlockdevSetActiveArgs is QAPI object 65.
type BlockdevSetActiveArgs struct {
	NodeName *string `json:"node-name,omitempty"`
	Active   bool    `json:"active"`
}

// BlockdevSnapshotArgs is QAPI object 39.
type BlockdevSnapshotArgs struct {
	Node    string `json:"node"`
	Overlay string `json:"overlay"`
}

// BlockdevSnapshotDeleteInternalSyncArgs is QAPI object 82.
type BlockdevSnapshotDeleteInternalSyncArgs struct {
	Device string  `json:"device"`
	Id     *string `json:"id,omitempty"`
	Name   *string `json:"name,omitempty"`
}

// BlockdevSnapshotDeleteInternalSyncResult is QAPI object 83.
type BlockdevSnapshotDeleteInternalSyncResult struct {
	Id          string `json:"id"`
	Name        string `json:"name"`
	VmStateSize int64  `json:"vm-state-size"`
	DateSec     int64  `json:"date-sec"`
	DateNsec    int64  `json:"date-nsec"`
	VmClockSec  int64  `json:"vm-clock-sec"`
	VmClockNsec int64  `json:"vm-clock-nsec"`
	Icount      *int64 `json:"icount,omitempty"`
}

// BlockdevSnapshotInternalSyncArgs is QAPI object 81.
type BlockdevSnapshotInternalSyncArgs struct {
	Device string `json:"device"`
	Name   string `json:"name"`
}

// BlockdevSnapshotSyncArgs is QAPI object 38.
type BlockdevSnapshotSyncArgs struct {
	Device           *string                       `json:"device,omitempty"`
	NodeName         *string                       `json:"node-name,omitempty"`
	SnapshotFile     string                        `json:"snapshot-file"`
	SnapshotNodeName *string                       `json:"snapshot-node-name,omitempty"`
	Format           *string                       `json:"format,omitempty"`
	Mode             *BlockdevSnapshotSyncArgsMode `json:"mode,omitempty"`
}

// COLOEXITEvent is QAPI object 156.
type COLOEXITEvent struct {
	Mode   COLOEXITEventMode   `json:"mode"`
	Reason COLOEXITEventReason `json:"reason"`
}

// CPUPOLARIZATIONCHANGEEvent is QAPI object 233.
type CPUPOLARIZATIONCHANGEEvent struct {
	Polarization CPUPOLARIZATIONCHANGEEventPolarization `json:"polarization"`
}

// CalcDirtyRateArgs is QAPI object 168.
type CalcDirtyRateArgs struct {
	CalcTime     int64                          `json:"calc-time"`
	CalcTimeUnit *CalcDirtyRateArgsCalcTimeUnit `json:"calc-time-unit,omitempty"`
	SamplePages  *int64                         `json:"sample-pages,omitempty"`
	Mode         *CalcDirtyRateArgsMode         `json:"mode,omitempty"`
}

// CancelVcpuDirtyLimitArgs is QAPI object 172.
type CancelVcpuDirtyLimitArgs struct {
	CpuIndex *int64 `json:"cpu-index,omitempty"`
}

// ChangeBackingFileArgs is QAPI object 40.
type ChangeBackingFileArgs struct {
	Device        string `json:"device"`
	ImageNodeName string `json:"image-node-name"`
	BackingFile   string `json:"backing-file"`
}

// ChangeVncPasswordArgs is QAPI object 139.
type ChangeVncPasswordArgs struct {
	Password string `json:"password"`
}

// ChardevAddArgs is QAPI object 95.
type ChardevAddArgs struct {
	Id      string                `json:"id"`
	Backend ChardevAddArgsBackend `json:"backend"`
}

// ChardevAddArgsBackend is QAPI object 380.
type ChardevAddArgsBackend struct {
	Type_ ChardevAddArgsBackendType_ `json:"type"`
	Data  any                        `json:"data,omitempty"`
}

// ChardevAddArgsBackendDbus is QAPI object 657.
type ChardevAddArgsBackendDbus struct {
	Data ChardevAddArgsBackendDbusData `json:"data"`
}

// ChardevAddArgsBackendDbusData is QAPI object 788.
type ChardevAddArgsBackendDbusData struct {
	Logfile      *string                                `json:"logfile,omitempty"`
	Logappend    *bool                                  `json:"logappend,omitempty"`
	Logtimestamp *bool                                  `json:"logtimestamp,omitempty"`
	Name         string                                 `json:"name"`
	Encoding     *ChardevAddArgsBackendDbusDataEncoding `json:"encoding,omitempty"`
}

// ChardevAddArgsBackendFile is QAPI object 645.
type ChardevAddArgsBackendFile struct {
	Data ChardevAddArgsBackendFileData `json:"data"`
}

// ChardevAddArgsBackendFileData is QAPI object 776.
type ChardevAddArgsBackendFileData struct {
	Logfile      *string `json:"logfile,omitempty"`
	Logappend    *bool   `json:"logappend,omitempty"`
	Logtimestamp *bool   `json:"logtimestamp,omitempty"`
	In           *string `json:"in,omitempty"`
	Out          string  `json:"out"`
	Append       *bool   `json:"append,omitempty"`
}

// ChardevAddArgsBackendHub is QAPI object 652.
type ChardevAddArgsBackendHub struct {
	Data ChardevAddArgsBackendHubData `json:"data"`
}

// ChardevAddArgsBackendHubData is QAPI object 783.
type ChardevAddArgsBackendHubData struct {
	Logfile      *string  `json:"logfile,omitempty"`
	Logappend    *bool    `json:"logappend,omitempty"`
	Logtimestamp *bool    `json:"logtimestamp,omitempty"`
	Chardevs     []string `json:"chardevs"`
}

// ChardevAddArgsBackendMux is QAPI object 651.
type ChardevAddArgsBackendMux struct {
	Data ChardevAddArgsBackendMuxData `json:"data"`
}

// ChardevAddArgsBackendMuxData is QAPI object 782.
type ChardevAddArgsBackendMuxData struct {
	Logfile      *string `json:"logfile,omitempty"`
	Logappend    *bool   `json:"logappend,omitempty"`
	Logtimestamp *bool   `json:"logtimestamp,omitempty"`
	Chardev      string  `json:"chardev"`
}

// ChardevAddArgsBackendNull is QAPI object 650.
type ChardevAddArgsBackendNull struct {
	Data ChardevAddArgsBackendNullData `json:"data"`
}

// ChardevAddArgsBackendNullData is QAPI object 781.
type ChardevAddArgsBackendNullData struct {
	Logfile      *string `json:"logfile,omitempty"`
	Logappend    *bool   `json:"logappend,omitempty"`
	Logtimestamp *bool   `json:"logtimestamp,omitempty"`
}

// ChardevAddArgsBackendPty is QAPI object 649.
type ChardevAddArgsBackendPty struct {
	Data ChardevAddArgsBackendPtyData `json:"data"`
}

// ChardevAddArgsBackendPtyData is QAPI object 780.
type ChardevAddArgsBackendPtyData struct {
	Logfile      *string `json:"logfile,omitempty"`
	Logappend    *bool   `json:"logappend,omitempty"`
	Logtimestamp *bool   `json:"logtimestamp,omitempty"`
	Path         *string `json:"path,omitempty"`
}

// ChardevAddArgsBackendQemuVdagent is QAPI object 656.
type ChardevAddArgsBackendQemuVdagent struct {
	Data ChardevAddArgsBackendQemuVdagentData `json:"data"`
}

// ChardevAddArgsBackendQemuVdagentData is QAPI object 787.
type ChardevAddArgsBackendQemuVdagentData struct {
	Logfile      *string `json:"logfile,omitempty"`
	Logappend    *bool   `json:"logappend,omitempty"`
	Logtimestamp *bool   `json:"logtimestamp,omitempty"`
	Mouse        *bool   `json:"mouse,omitempty"`
	Clipboard    *bool   `json:"clipboard,omitempty"`
}

// ChardevAddArgsBackendRingbuf is QAPI object 659.
type ChardevAddArgsBackendRingbuf struct {
	Data ChardevAddArgsBackendRingbufData `json:"data"`
}

// ChardevAddArgsBackendRingbufData is QAPI object 790.
type ChardevAddArgsBackendRingbufData struct {
	Logfile      *string `json:"logfile,omitempty"`
	Logappend    *bool   `json:"logappend,omitempty"`
	Logtimestamp *bool   `json:"logtimestamp,omitempty"`
	Size         *int64  `json:"size,omitempty"`
}

// ChardevAddArgsBackendSerial is QAPI object 646.
type ChardevAddArgsBackendSerial struct {
	Data ChardevAddArgsBackendSerialData `json:"data"`
}

// ChardevAddArgsBackendSerialData is QAPI object 777.
type ChardevAddArgsBackendSerialData struct {
	Logfile      *string `json:"logfile,omitempty"`
	Logappend    *bool   `json:"logappend,omitempty"`
	Logtimestamp *bool   `json:"logtimestamp,omitempty"`
	Device       string  `json:"device"`
}

// ChardevAddArgsBackendSocket is QAPI object 647.
type ChardevAddArgsBackendSocket struct {
	Data ChardevAddArgsBackendSocketData `json:"data"`
}

// ChardevAddArgsBackendSocketData is QAPI object 778.
type ChardevAddArgsBackendSocketData struct {
	Logfile      *string                `json:"logfile,omitempty"`
	Logappend    *bool                  `json:"logappend,omitempty"`
	Logtimestamp *bool                  `json:"logtimestamp,omitempty"`
	Addr         NbdServerStartArgsAddr `json:"addr"`
	TlsCreds     *string                `json:"tls-creds,omitempty"`
	TlsAuthz     *string                `json:"tls-authz,omitempty"`
	Server       *bool                  `json:"server,omitempty"`
	Wait         *bool                  `json:"wait,omitempty"`
	Nodelay      *bool                  `json:"nodelay,omitempty"`
	Telnet       *bool                  `json:"telnet,omitempty"`
	Tn3270       *bool                  `json:"tn3270,omitempty"`
	Websocket    *bool                  `json:"websocket,omitempty"`
	ReconnectMs  *int64                 `json:"reconnect-ms,omitempty"`
}

// ChardevAddArgsBackendSpiceport is QAPI object 655.
type ChardevAddArgsBackendSpiceport struct {
	Data ChardevAddArgsBackendSpiceportData `json:"data"`
}

// ChardevAddArgsBackendSpiceportData is QAPI object 786.
type ChardevAddArgsBackendSpiceportData struct {
	Logfile      *string `json:"logfile,omitempty"`
	Logappend    *bool   `json:"logappend,omitempty"`
	Logtimestamp *bool   `json:"logtimestamp,omitempty"`
	Fqdn         string  `json:"fqdn"`
}

// ChardevAddArgsBackendSpicevmc is QAPI object 654.
type ChardevAddArgsBackendSpicevmc struct {
	Data ChardevAddArgsBackendSpicevmcData `json:"data"`
}

// ChardevAddArgsBackendSpicevmcData is QAPI object 785.
type ChardevAddArgsBackendSpicevmcData struct {
	Logfile      *string `json:"logfile,omitempty"`
	Logappend    *bool   `json:"logappend,omitempty"`
	Logtimestamp *bool   `json:"logtimestamp,omitempty"`
	Type_        string  `json:"type"`
}

// ChardevAddArgsBackendStdio is QAPI object 653.
type ChardevAddArgsBackendStdio struct {
	Data ChardevAddArgsBackendStdioData `json:"data"`
}

// ChardevAddArgsBackendStdioData is QAPI object 784.
type ChardevAddArgsBackendStdioData struct {
	Logfile      *string `json:"logfile,omitempty"`
	Logappend    *bool   `json:"logappend,omitempty"`
	Logtimestamp *bool   `json:"logtimestamp,omitempty"`
	Signal       *bool   `json:"signal,omitempty"`
}

// ChardevAddArgsBackendUdp is QAPI object 648.
type ChardevAddArgsBackendUdp struct {
	Data ChardevAddArgsBackendUdpData `json:"data"`
}

// ChardevAddArgsBackendUdpData is QAPI object 779.
type ChardevAddArgsBackendUdpData struct {
	Logfile      *string                 `json:"logfile,omitempty"`
	Logappend    *bool                   `json:"logappend,omitempty"`
	Logtimestamp *bool                   `json:"logtimestamp,omitempty"`
	Remote       NbdServerStartArgsAddr  `json:"remote"`
	Local        *NbdServerStartArgsAddr `json:"local,omitempty"`
}

// ChardevAddArgsBackendVc is QAPI object 658.
type ChardevAddArgsBackendVc struct {
	Data ChardevAddArgsBackendVcData `json:"data"`
}

// ChardevAddArgsBackendVcData is QAPI object 789.
type ChardevAddArgsBackendVcData struct {
	Logfile      *string                                `json:"logfile,omitempty"`
	Logappend    *bool                                  `json:"logappend,omitempty"`
	Logtimestamp *bool                                  `json:"logtimestamp,omitempty"`
	Width        *int64                                 `json:"width,omitempty"`
	Height       *int64                                 `json:"height,omitempty"`
	Cols         *int64                                 `json:"cols,omitempty"`
	Rows         *int64                                 `json:"rows,omitempty"`
	Encoding     *ChardevAddArgsBackendDbusDataEncoding `json:"encoding,omitempty"`
}

// ChardevAddResult is QAPI object 96.
type ChardevAddResult struct {
	Pty *string `json:"pty,omitempty"`
}

// ChardevChangeArgs is QAPI object 97.
type ChardevChangeArgs struct {
	Id      string                `json:"id"`
	Backend ChardevAddArgsBackend `json:"backend"`
}

// ChardevRemoveArgs is QAPI object 98.
type ChardevRemoveArgs struct {
	Id string `json:"id"`
}

// ChardevSendBreakArgs is QAPI object 99.
type ChardevSendBreakArgs struct {
	Id string `json:"id"`
}

// ClientMigrateInfoArgs is QAPI object 149.
type ClientMigrateInfoArgs struct {
	Protocol    string  `json:"protocol"`
	Hostname    string  `json:"hostname"`
	Port        *int64  `json:"port,omitempty"`
	TlsPort     *int64  `json:"tls-port,omitempty"`
	CertSubject *string `json:"cert-subject,omitempty"`
}

// ClosefdArgs is QAPI object 246.
type ClosefdArgs struct {
	Fdname string `json:"fdname"`
}

// CxlAddDynamicCapacityArgs is QAPI object 291.
type CxlAddDynamicCapacityArgs struct {
	Path            string                                   `json:"path"`
	HostId          int64                                    `json:"host-id"`
	SelectionPolicy CxlAddDynamicCapacityArgsSelectionPolicy `json:"selection-policy"`
	Region          int64                                    `json:"region"`
	Tag             *string                                  `json:"tag,omitempty"`
	Extents         []TypeN589                               `json:"extents"`
}

// CxlInjectCorrectableErrorArgs is QAPI object 290.
type CxlInjectCorrectableErrorArgs struct {
	Path  string                             `json:"path"`
	Type_ CxlInjectCorrectableErrorArgsType_ `json:"type"`
}

// CxlInjectDramEventArgs is QAPI object 286.
type CxlInjectDramEventArgs struct {
	Path            string                            `json:"path"`
	Log             CxlInjectGeneralMediaEventArgsLog `json:"log"`
	Flags           int64                             `json:"flags"`
	MaintOpClass    *int64                            `json:"maint-op-class,omitempty"`
	MaintOpSubclass *int64                            `json:"maint-op-subclass,omitempty"`
	LdId            *int64                            `json:"ld-id,omitempty"`
	HeadId          *int64                            `json:"head-id,omitempty"`
	Dpa             int64                             `json:"dpa"`
	Descriptor      int64                             `json:"descriptor"`
	Type_           int64                             `json:"type"`
	TransactionType int64                             `json:"transaction-type"`
	Channel         *int64                            `json:"channel,omitempty"`
	Rank            *int64                            `json:"rank,omitempty"`
	NibbleMask      *int64                            `json:"nibble-mask,omitempty"`
	BankGroup       *int64                            `json:"bank-group,omitempty"`
	Bank            *int64                            `json:"bank,omitempty"`
	Row             *int64                            `json:"row,omitempty"`
	Column          *int64                            `json:"column,omitempty"`
	CorrectionMask  []int64                           `json:"correction-mask,omitempty"`
	ComponentId     *string                           `json:"component-id,omitempty"`
	IsCompIdPldm    *bool                             `json:"is-comp-id-pldm,omitempty"`
	SubChannel      *int64                            `json:"sub-channel,omitempty"`
	CmeEvFlags      *int64                            `json:"cme-ev-flags,omitempty"`
	CvmeCount       *int64                            `json:"cvme-count,omitempty"`
	SubType         int64                             `json:"sub-type"`
}

// CxlInjectGeneralMediaEventArgs is QAPI object 285.
type CxlInjectGeneralMediaEventArgs struct {
	Path            string                            `json:"path"`
	Log             CxlInjectGeneralMediaEventArgsLog `json:"log"`
	Flags           int64                             `json:"flags"`
	MaintOpClass    *int64                            `json:"maint-op-class,omitempty"`
	MaintOpSubclass *int64                            `json:"maint-op-subclass,omitempty"`
	LdId            *int64                            `json:"ld-id,omitempty"`
	HeadId          *int64                            `json:"head-id,omitempty"`
	Dpa             int64                             `json:"dpa"`
	Descriptor      int64                             `json:"descriptor"`
	Type_           int64                             `json:"type"`
	TransactionType int64                             `json:"transaction-type"`
	Channel         *int64                            `json:"channel,omitempty"`
	Rank            *int64                            `json:"rank,omitempty"`
	Device          *int64                            `json:"device,omitempty"`
	ComponentId     *string                           `json:"component-id,omitempty"`
	IsCompIdPldm    *bool                             `json:"is-comp-id-pldm,omitempty"`
	CmeEvFlags      *int64                            `json:"cme-ev-flags,omitempty"`
	CmeCount        *int64                            `json:"cme-count,omitempty"`
	SubType         int64                             `json:"sub-type"`
}

// CxlInjectMemoryModuleEventArgs is QAPI object 287.
type CxlInjectMemoryModuleEventArgs struct {
	Path                          string                            `json:"path"`
	Log                           CxlInjectGeneralMediaEventArgsLog `json:"log"`
	Flags                         int64                             `json:"flags"`
	MaintOpClass                  *int64                            `json:"maint-op-class,omitempty"`
	MaintOpSubclass               *int64                            `json:"maint-op-subclass,omitempty"`
	LdId                          *int64                            `json:"ld-id,omitempty"`
	HeadId                        *int64                            `json:"head-id,omitempty"`
	Type_                         int64                             `json:"type"`
	HealthStatus                  int64                             `json:"health-status"`
	MediaStatus                   int64                             `json:"media-status"`
	AdditionalStatus              int64                             `json:"additional-status"`
	LifeUsed                      int64                             `json:"life-used"`
	Temperature                   int64                             `json:"temperature"`
	DirtyShutdownCount            int64                             `json:"dirty-shutdown-count"`
	CorrectedVolatileErrorCount   int64                             `json:"corrected-volatile-error-count"`
	CorrectedPersistentErrorCount int64                             `json:"corrected-persistent-error-count"`
	ComponentId                   *string                           `json:"component-id,omitempty"`
	IsCompIdPldm                  *bool                             `json:"is-comp-id-pldm,omitempty"`
	SubType                       int64                             `json:"sub-type"`
}

// CxlInjectPoisonArgs is QAPI object 288.
type CxlInjectPoisonArgs struct {
	Path   string `json:"path"`
	Start  int64  `json:"start"`
	Length int64  `json:"length"`
}

// CxlInjectUncorrectableErrorsArgs is QAPI object 289.
type CxlInjectUncorrectableErrorsArgs struct {
	Path   string     `json:"path"`
	Errors []TypeN586 `json:"errors"`
}

// CxlReleaseDynamicCapacityArgs is QAPI object 292.
type CxlReleaseDynamicCapacityArgs struct {
	Path              string                                     `json:"path"`
	HostId            int64                                      `json:"host-id"`
	RemovalPolicy     CxlReleaseDynamicCapacityArgsRemovalPolicy `json:"removal-policy"`
	ForcedRemoval     *bool                                      `json:"forced-removal,omitempty"`
	SanitizeOnRelease *bool                                      `json:"sanitize-on-release,omitempty"`
	Region            int64                                      `json:"region"`
	Tag               *string                                    `json:"tag,omitempty"`
	Extents           []TypeN589                                 `json:"extents"`
}

// DEVICEDELETEDEvent is QAPI object 199.
type DEVICEDELETEDEvent struct {
	Device *string `json:"device,omitempty"`
	Path   string  `json:"path"`
}

// DEVICETRAYMOVEDEvent is QAPI object 28.
type DEVICETRAYMOVEDEvent struct {
	Device   string `json:"device"`
	Id       string `json:"id"`
	TrayOpen bool   `json:"tray-open"`
}

// DEVICEUNPLUGGUESTERROREvent is QAPI object 200.
type DEVICEUNPLUGGUESTERROREvent struct {
	Device *string `json:"device,omitempty"`
	Path   string  `json:"path"`
}

// DUMPCOMPLETEDEvent is QAPI object 103.
type DUMPCOMPLETEDEvent struct {
	Result QueryDumpResult `json:"result"`
	Error  *string         `json:"error,omitempty"`
}

// DeviceAddArgs is QAPI object 197.
type DeviceAddArgs struct {
	Driver string  `json:"driver"`
	Bus    *string `json:"bus,omitempty"`
	Id     *string `json:"id,omitempty"`
}

// DeviceDelArgs is QAPI object 198.
type DeviceDelArgs struct {
	Id string `json:"id"`
}

// DeviceListPropertiesArgs is QAPI object 196.
type DeviceListPropertiesArgs struct {
	Typename string `json:"typename"`
}

// DeviceSyncConfigArgs is QAPI object 201.
type DeviceSyncConfigArgs struct {
	Id string `json:"id"`
}

// DisplayReloadArgs is QAPI object 147.
type DisplayReloadArgs struct {
	Type_    DisplayReloadArgsType_ `json:"type"`
	TlsCerts *bool                  `json:"tls-certs,omitempty"`
}

// DisplayReloadArgsVnc is QAPI object 438.
type DisplayReloadArgsVnc struct {
	TlsCerts *bool `json:"tls-certs,omitempty"`
}

// DisplayUpdateArgs is QAPI object 148.
type DisplayUpdateArgs struct {
	Type_     DisplayUpdateArgsType_           `json:"type"`
	Addresses []NETDEVSTREAMCONNECTEDEventAddr `json:"addresses,omitempty"`
}

// DisplayUpdateArgsVnc is QAPI object 440.
type DisplayUpdateArgsVnc struct {
	Addresses []NETDEVSTREAMCONNECTEDEventAddr `json:"addresses,omitempty"`
}

// DriveBackupArgs is QAPI object 42.
type DriveBackupArgs struct {
	JobId          *string                       `json:"job-id,omitempty"`
	Device         string                        `json:"device"`
	Sync           DriveBackupArgsSync           `json:"sync"`
	Speed          *int64                        `json:"speed,omitempty"`
	Bitmap         *string                       `json:"bitmap,omitempty"`
	BitmapMode     *DriveBackupArgsBitmapMode    `json:"bitmap-mode,omitempty"`
	Compress       *bool                         `json:"compress,omitempty"`
	OnSourceError  *BlockCommitArgsOnError       `json:"on-source-error,omitempty"`
	OnTargetError  *BlockCommitArgsOnError       `json:"on-target-error,omitempty"`
	OnCbwError     *DriveBackupArgsOnCbwError    `json:"on-cbw-error,omitempty"`
	AutoFinalize   *bool                         `json:"auto-finalize,omitempty"`
	AutoDismiss    *bool                         `json:"auto-dismiss,omitempty"`
	FilterNodeName *string                       `json:"filter-node-name,omitempty"`
	DiscardSource  *bool                         `json:"discard-source,omitempty"`
	XPerf          *DriveBackupArgsXPerf         `json:"x-perf,omitempty"`
	Target         string                        `json:"target"`
	Format         *string                       `json:"format,omitempty"`
	Mode           *BlockdevSnapshotSyncArgsMode `json:"mode,omitempty"`
}

// DriveBackupArgsXPerf is QAPI object 317.
type DriveBackupArgsXPerf struct {
	UseCopyRange   *bool  `json:"use-copy-range,omitempty"`
	MaxWorkers     *int64 `json:"max-workers,omitempty"`
	MaxChunk       *int64 `json:"max-chunk,omitempty"`
	MinClusterSize *int64 `json:"min-cluster-size,omitempty"`
}

// DriveMirrorArgs is QAPI object 47.
type DriveMirrorArgs struct {
	JobId         *string                       `json:"job-id,omitempty"`
	Device        string                        `json:"device"`
	Target        string                        `json:"target"`
	Format        *string                       `json:"format,omitempty"`
	NodeName      *string                       `json:"node-name,omitempty"`
	Replaces      *string                       `json:"replaces,omitempty"`
	Sync          DriveBackupArgsSync           `json:"sync"`
	Mode          *BlockdevSnapshotSyncArgsMode `json:"mode,omitempty"`
	Speed         *int64                        `json:"speed,omitempty"`
	Granularity   *int64                        `json:"granularity,omitempty"`
	BufSize       *int64                        `json:"buf-size,omitempty"`
	OnSourceError *BlockCommitArgsOnError       `json:"on-source-error,omitempty"`
	OnTargetError *BlockCommitArgsOnError       `json:"on-target-error,omitempty"`
	Unmap         *bool                         `json:"unmap,omitempty"`
	CopyMode      *DriveMirrorArgsCopyMode      `json:"copy-mode,omitempty"`
	AutoFinalize  *bool                         `json:"auto-finalize,omitempty"`
	AutoDismiss   *bool                         `json:"auto-dismiss,omitempty"`
}

// DumpGuestMemoryArgs is QAPI object 101.
type DumpGuestMemoryArgs struct {
	Paging   bool                       `json:"paging"`
	Protocol string                     `json:"protocol"`
	Detach   *bool                      `json:"detach,omitempty"`
	Begin    *int64                     `json:"begin,omitempty"`
	Length   *int64                     `json:"length,omitempty"`
	Format   *DumpGuestMemoryArgsFormat `json:"format,omitempty"`
}

// DumpSkeysArgs is QAPI object 224.
type DumpSkeysArgs struct {
	Filename string `json:"filename"`
}

// DumpdtbArgs is QAPI object 221.
type DumpdtbArgs struct {
	Filename string `json:"filename"`
}

// EjectArgs is QAPI object 22.
type EjectArgs struct {
	Device *string `json:"device,omitempty"`
	Id     *string `json:"id,omitempty"`
	Force  *bool   `json:"force,omitempty"`
}

// Empty is the QAPI empty object.
type Empty struct{}

// ExpirePasswordArgs is QAPI object 131.
type ExpirePasswordArgs struct {
	Protocol SetPasswordArgsProtocol `json:"protocol"`
	Time     string                  `json:"time"`
	Display  *string                 `json:"display,omitempty"`
}

// ExpirePasswordArgsVnc is QAPI object 414.
type ExpirePasswordArgsVnc struct {
	Display *string `json:"display,omitempty"`
}

// FAILOVERNEGOTIATEDEvent is QAPI object 112.
type FAILOVERNEGOTIATEDEvent struct {
	DeviceId string `json:"device-id"`
}

// GUESTCRASHLOADEDEvent is QAPI object 8.
type GUESTCRASHLOADEDEvent struct {
	Action GUESTPANICKEDEventAction `json:"action"`
	Info   *GUESTPANICKEDEventInfo  `json:"info,omitempty"`
}

// GUESTPANICKEDEvent is QAPI object 7.
type GUESTPANICKEDEvent struct {
	Action GUESTPANICKEDEventAction `json:"action"`
	Info   *GUESTPANICKEDEventInfo  `json:"info,omitempty"`
}

// GUESTPANICKEDEventInfo is QAPI object 300.
type GUESTPANICKEDEventInfo struct {
	Type_     GUESTPANICKEDEventInfoType_       `json:"type"`
	Arg1      *int64                            `json:"arg1,omitempty"`
	Arg2      *int64                            `json:"arg2,omitempty"`
	Arg3      *int64                            `json:"arg3,omitempty"`
	Arg4      *int64                            `json:"arg4,omitempty"`
	Arg5      *int64                            `json:"arg5,omitempty"`
	Core      *int64                            `json:"core,omitempty"`
	PswMask   *int64                            `json:"psw-mask,omitempty"`
	PswAddr   *int64                            `json:"psw-addr,omitempty"`
	Reason    *GUESTPANICKEDEventInfoS390Reason `json:"reason,omitempty"`
	ErrorCode *int64                            `json:"error-code,omitempty"`
	Message   *string                           `json:"message,omitempty"`
	Gpa       *int64                            `json:"gpa,omitempty"`
	Set       *int64                            `json:"set,omitempty"`
	Code      *int64                            `json:"code,omitempty"`
}

// GUESTPANICKEDEventInfoHyperV is QAPI object 592.
type GUESTPANICKEDEventInfoHyperV struct {
	Arg1 int64 `json:"arg1"`
	Arg2 int64 `json:"arg2"`
	Arg3 int64 `json:"arg3"`
	Arg4 int64 `json:"arg4"`
	Arg5 int64 `json:"arg5"`
}

// GUESTPANICKEDEventInfoS390 is QAPI object 593.
type GUESTPANICKEDEventInfoS390 struct {
	Core    int64                            `json:"core"`
	PswMask int64                            `json:"psw-mask"`
	PswAddr int64                            `json:"psw-addr"`
	Reason  GUESTPANICKEDEventInfoS390Reason `json:"reason"`
}

// GUESTPANICKEDEventInfoSev is QAPI object 595.
type GUESTPANICKEDEventInfoSev struct {
	Set  int64 `json:"set"`
	Code int64 `json:"code"`
}

// GUESTPANICKEDEventInfoTdx is QAPI object 594.
type GUESTPANICKEDEventInfoTdx struct {
	ErrorCode int64  `json:"error-code"`
	Message   string `json:"message"`
	Gpa       *int64 `json:"gpa,omitempty"`
}

// GetfdArgs is QAPI object 244.
type GetfdArgs struct {
	Fdname string `json:"fdname"`
}

// HumanMonitorCommandArgs is QAPI object 243.
type HumanMonitorCommandArgs struct {
	CommandLine string `json:"command-line"`
	CpuIndex    *int64 `json:"cpu-index,omitempty"`
}

// InjectGhesV2ErrorArgs is QAPI object 268.
type InjectGhesV2ErrorArgs struct {
	Cper string `json:"cper"`
}

// InputSendEventArgs is QAPI object 145.
type InputSendEventArgs struct {
	Device *string    `json:"device,omitempty"`
	Head   *int64     `json:"head,omitempty"`
	Events []TypeN428 `json:"events"`
}

// JOBSTATUSCHANGEEvent is QAPI object 10.
type JOBSTATUSCHANGEEvent struct {
	Id     string                     `json:"id"`
	Status JOBSTATUSCHANGEEventStatus `json:"status"`
}

// JobCancelArgs is QAPI object 13.
type JobCancelArgs struct {
	Id string `json:"id"`
}

// JobCompleteArgs is QAPI object 14.
type JobCompleteArgs struct {
	Id string `json:"id"`
}

// JobDismissArgs is QAPI object 15.
type JobDismissArgs struct {
	Id string `json:"id"`
}

// JobFinalizeArgs is QAPI object 16.
type JobFinalizeArgs struct {
	Id string `json:"id"`
}

// JobPauseArgs is QAPI object 11.
type JobPauseArgs struct {
	Id string `json:"id"`
}

// JobResumeArgs is QAPI object 12.
type JobResumeArgs struct {
	Id string `json:"id"`
}

// KeyValue is QAPI object 427.
type KeyValue struct {
	Type_ KeyValueKind `json:"type"`
	Data  any          `json:"data,omitempty"`
}

// KeyValueNumber is QAPI object 673.
type KeyValueNumber struct {
	Data int64 `json:"data"`
}

// KeyValueQcode is QAPI object 674.
type KeyValueQcode struct {
	Data QKeyCode `json:"data"`
}

// MEMORYDEVICESIZECHANGEEvent is QAPI object 220.
type MEMORYDEVICESIZECHANGEEvent struct {
	Id      *string `json:"id,omitempty"`
	Size    int64   `json:"size"`
	QomPath string  `json:"qom-path"`
}

// MEMORYFAILUREEvent is QAPI object 9.
type MEMORYFAILUREEvent struct {
	Recipient MEMORYFAILUREEventRecipient `json:"recipient"`
	Action    MEMORYFAILUREEventAction    `json:"action"`
	Flags     MEMORYFAILUREEventFlags     `json:"flags"`
}

// MEMORYFAILUREEventFlags is QAPI object 303.
type MEMORYFAILUREEventFlags struct {
	ActionRequired bool `json:"action-required"`
	Recursive      bool `json:"recursive"`
}

// MIGRATIONEvent is QAPI object 154.
type MIGRATIONEvent struct {
	Status QueryMigrateResultStatus `json:"status"`
}

// MIGRATIONPASSEvent is QAPI object 155.
type MIGRATIONPASSEvent struct {
	Pass int64 `json:"pass"`
}

// MemsaveArgs is QAPI object 209.
type MemsaveArgs struct {
	Val      int64  `json:"val"`
	Size     int64  `json:"size"`
	Filename string `json:"filename"`
	CpuIndex *int64 `json:"cpu-index,omitempty"`
}

// MigrateArgs is QAPI object 158.
type MigrateArgs struct {
	Uri      *string    `json:"uri,omitempty"`
	Channels []TypeN452 `json:"channels,omitempty"`
	Resume   *bool      `json:"resume,omitempty"`
}

// MigrateContinueArgs is QAPI object 157.
type MigrateContinueArgs struct {
	State QueryMigrateResultStatus `json:"state"`
}

// MigrateIncomingArgs is QAPI object 159.
type MigrateIncomingArgs struct {
	Uri         *string    `json:"uri,omitempty"`
	Channels    []TypeN452 `json:"channels,omitempty"`
	ExitOnError *bool      `json:"exit-on-error,omitempty"`
}

// MigrateRecoverArgs is QAPI object 166.
type MigrateRecoverArgs struct {
	Uri string `json:"uri"`
}

// MigrateSetCapabilitiesArgs is QAPI object 151.
type MigrateSetCapabilitiesArgs struct {
	Capabilities []TypeN152 `json:"capabilities"`
}

// MigrateSetParametersArgs is QAPI object 153.
type MigrateSetParametersArgs struct {
	AnnounceInitial          *int64                                      `json:"announce-initial,omitempty"`
	AnnounceMax              *int64                                      `json:"announce-max,omitempty"`
	AnnounceRounds           *int64                                      `json:"announce-rounds,omitempty"`
	AnnounceStep             *int64                                      `json:"announce-step,omitempty"`
	ThrottleTriggerThreshold *int64                                      `json:"throttle-trigger-threshold,omitempty"`
	CpuThrottleInitial       *int64                                      `json:"cpu-throttle-initial,omitempty"`
	CpuThrottleIncrement     *int64                                      `json:"cpu-throttle-increment,omitempty"`
	CpuThrottleTailslow      *bool                                       `json:"cpu-throttle-tailslow,omitempty"`
	TlsCreds                 *XBlockdevSetIothreadArgsIothread           `json:"tls-creds,omitempty"`
	TlsHostname              *XBlockdevSetIothreadArgsIothread           `json:"tls-hostname,omitempty"`
	TlsAuthz                 *XBlockdevSetIothreadArgsIothread           `json:"tls-authz,omitempty"`
	MaxBandwidth             *int64                                      `json:"max-bandwidth,omitempty"`
	AvailSwitchoverBandwidth *int64                                      `json:"avail-switchover-bandwidth,omitempty"`
	DowntimeLimit            *int64                                      `json:"downtime-limit,omitempty"`
	XCheckpointDelay         *int64                                      `json:"x-checkpoint-delay,omitempty"`
	MultifdChannels          *int64                                      `json:"multifd-channels,omitempty"`
	XbzrleCacheSize          *int64                                      `json:"xbzrle-cache-size,omitempty"`
	MaxPostcopyBandwidth     *int64                                      `json:"max-postcopy-bandwidth,omitempty"`
	MaxCpuThrottle           *int64                                      `json:"max-cpu-throttle,omitempty"`
	MultifdCompression       *MigrateSetParametersArgsMultifdCompression `json:"multifd-compression,omitempty"`
	MultifdZlibLevel         *int64                                      `json:"multifd-zlib-level,omitempty"`
	MultifdQatzipLevel       *int64                                      `json:"multifd-qatzip-level,omitempty"`
	MultifdZstdLevel         *int64                                      `json:"multifd-zstd-level,omitempty"`
	BlockBitmapMapping       []TypeN447                                  `json:"block-bitmap-mapping,omitempty"`
	XVcpuDirtyLimitPeriod    *int64                                      `json:"x-vcpu-dirty-limit-period,omitempty"`
	VcpuDirtyLimit           *int64                                      `json:"vcpu-dirty-limit,omitempty"`
	Mode                     *MigrateSetParametersArgsMode               `json:"mode,omitempty"`
	ZeroPageDetection        *MigrateSetParametersArgsZeroPageDetection  `json:"zero-page-detection,omitempty"`
	DirectIo                 *bool                                       `json:"direct-io,omitempty"`
	XRdmaChunkSize           *int64                                      `json:"x-rdma-chunk-size,omitempty"`
	CprExecCommand           []string                                    `json:"cpr-exec-command,omitempty"`
}

// NETDEVSTREAMCONNECTEDEvent is QAPI object 113.
type NETDEVSTREAMCONNECTEDEvent struct {
	NetdevId string                         `json:"netdev-id"`
	Addr     NETDEVSTREAMCONNECTEDEventAddr `json:"addr"`
}

// NETDEVSTREAMCONNECTEDEventAddr is QAPI object 403.
type NETDEVSTREAMCONNECTEDEventAddr struct {
	Type_             NbdServerStartArgsAddrType_ `json:"type"`
	Host              *string                     `json:"host,omitempty"`
	Port              *string                     `json:"port,omitempty"`
	Numeric           *bool                       `json:"numeric,omitempty"`
	To                *int64                      `json:"to,omitempty"`
	Ipv4              *bool                       `json:"ipv4,omitempty"`
	Ipv6              *bool                       `json:"ipv6,omitempty"`
	KeepAlive         *bool                       `json:"keep-alive,omitempty"`
	KeepAliveCount    *int64                      `json:"keep-alive-count,omitempty"`
	KeepAliveIdle     *int64                      `json:"keep-alive-idle,omitempty"`
	KeepAliveInterval *int64                      `json:"keep-alive-interval,omitempty"`
	Mptcp             *bool                       `json:"mptcp,omitempty"`
	Path              *string                     `json:"path,omitempty"`
	Abstract          *bool                       `json:"abstract,omitempty"`
	Tight             *bool                       `json:"tight,omitempty"`
	Cid               *string                     `json:"cid,omitempty"`
	Str               *string                     `json:"str,omitempty"`
}

// NETDEVSTREAMCONNECTEDEventAddrFd is QAPI object 669.
type NETDEVSTREAMCONNECTEDEventAddrFd struct {
	Str string `json:"str"`
}

// NETDEVSTREAMCONNECTEDEventAddrUnix is QAPI object 667.
type NETDEVSTREAMCONNECTEDEventAddrUnix struct {
	Path     string `json:"path"`
	Abstract *bool  `json:"abstract,omitempty"`
	Tight    *bool  `json:"tight,omitempty"`
}

// NETDEVSTREAMCONNECTEDEventAddrVsock is QAPI object 668.
type NETDEVSTREAMCONNECTEDEventAddrVsock struct {
	Cid  string `json:"cid"`
	Port string `json:"port"`
}

// NETDEVSTREAMDISCONNECTEDEvent is QAPI object 114.
type NETDEVSTREAMDISCONNECTEDEvent struct {
	NetdevId string `json:"netdev-id"`
}

// NETDEVVHOSTUSERCONNECTEDEvent is QAPI object 115.
type NETDEVVHOSTUSERCONNECTEDEvent struct {
	NetdevId  string `json:"netdev-id"`
	ChardevId string `json:"chardev-id"`
}

// NETDEVVHOSTUSERDISCONNECTEDEvent is QAPI object 116.
type NETDEVVHOSTUSERDISCONNECTEDEvent struct {
	NetdevId string `json:"netdev-id"`
}

// NICRXFILTERCHANGEDEvent is QAPI object 110.
type NICRXFILTERCHANGEDEvent struct {
	Name *string `json:"name,omitempty"`
	Path string  `json:"path"`
}

// NbdServerAddArgs is QAPI object 85.
type NbdServerAddArgs struct {
	Name        *string `json:"name,omitempty"`
	Description *string `json:"description,omitempty"`
	Device      string  `json:"device"`
	Writable    *bool   `json:"writable,omitempty"`
	Bitmap      *string `json:"bitmap,omitempty"`
}

// NbdServerRemoveArgs is QAPI object 86.
type NbdServerRemoveArgs struct {
	Name string                   `json:"name"`
	Mode *NbdServerRemoveArgsMode `json:"mode,omitempty"`
}

// NbdServerStartArgs is QAPI object 84.
type NbdServerStartArgs struct {
	HandshakeMaxSeconds *int64                 `json:"handshake-max-seconds,omitempty"`
	TlsCreds            *string                `json:"tls-creds,omitempty"`
	TlsAuthz            *string                `json:"tls-authz,omitempty"`
	MaxConnections      *int64                 `json:"max-connections,omitempty"`
	Addr                NbdServerStartArgsAddr `json:"addr"`
}

// NbdServerStartArgsAddr is QAPI object 371.
type NbdServerStartArgsAddr struct {
	Type_ NbdServerStartArgsAddrType_ `json:"type"`
	Data  any                         `json:"data,omitempty"`
}

// NbdServerStartArgsAddrFd is QAPI object 642.
type NbdServerStartArgsAddrFd struct {
	Data NETDEVSTREAMCONNECTEDEventAddrFd `json:"data"`
}

// NbdServerStartArgsAddrInet is QAPI object 639.
type NbdServerStartArgsAddrInet struct {
	Data BlockdevAddArgsSshServer `json:"data"`
}

// NbdServerStartArgsAddrUnix is QAPI object 640.
type NbdServerStartArgsAddrUnix struct {
	Data NETDEVSTREAMCONNECTEDEventAddrUnix `json:"data"`
}

// NbdServerStartArgsAddrVsock is QAPI object 641.
type NbdServerStartArgsAddrVsock struct {
	Data NETDEVSTREAMCONNECTEDEventAddrVsock `json:"data"`
}

// NetdevAddArgs is QAPI object 106.
type NetdevAddArgs struct {
	Id              string                          `json:"id"`
	Type_           NetdevAddArgsType_              `json:"type"`
	Netdev          *string                         `json:"netdev,omitempty"`
	Macaddr         *string                         `json:"macaddr,omitempty"`
	Model           *string                         `json:"model,omitempty"`
	Addr            any                             `json:"addr,omitempty"`
	Vectors         *int64                          `json:"vectors,omitempty"`
	Path            *string                         `json:"path,omitempty"`
	Quiet           *bool                           `json:"quiet,omitempty"`
	VhostUser       *bool                           `json:"vhost-user,omitempty"`
	Mtu             *int64                          `json:"mtu,omitempty"`
	Address         *string                         `json:"address,omitempty"`
	Netmask         *string                         `json:"netmask,omitempty"`
	Mac             *string                         `json:"mac,omitempty"`
	Gateway         *string                         `json:"gateway,omitempty"`
	Interface_      *string                         `json:"interface,omitempty"`
	Outbound        *string                         `json:"outbound,omitempty"`
	OutboundIf4     *string                         `json:"outbound-if4,omitempty"`
	OutboundIf6     *string                         `json:"outbound-if6,omitempty"`
	Dns             *string                         `json:"dns,omitempty"`
	Search          []TypeN660                      `json:"search,omitempty"`
	Fqdn            *string                         `json:"fqdn,omitempty"`
	DhcpDns         *bool                           `json:"dhcp-dns,omitempty"`
	DhcpSearch      *bool                           `json:"dhcp-search,omitempty"`
	MapHostLoopback *string                         `json:"map-host-loopback,omitempty"`
	MapGuestAddr    *string                         `json:"map-guest-addr,omitempty"`
	DnsForward      *string                         `json:"dns-forward,omitempty"`
	DnsHost         *string                         `json:"dns-host,omitempty"`
	Tcp             *bool                           `json:"tcp,omitempty"`
	Udp             any                             `json:"udp,omitempty"`
	Icmp            *bool                           `json:"icmp,omitempty"`
	Dhcp            *bool                           `json:"dhcp,omitempty"`
	Ndp             *bool                           `json:"ndp,omitempty"`
	Dhcpv6          *bool                           `json:"dhcpv6,omitempty"`
	Ra              *bool                           `json:"ra,omitempty"`
	Freebind        *bool                           `json:"freebind,omitempty"`
	Ipv4            *bool                           `json:"ipv4,omitempty"`
	Ipv6            *bool                           `json:"ipv6,omitempty"`
	TcpPorts        []TypeN661                      `json:"tcp-ports,omitempty"`
	UdpPorts        []TypeN661                      `json:"udp-ports,omitempty"`
	Param           []TypeN662                      `json:"param,omitempty"`
	Hostname        *string                         `json:"hostname,omitempty"`
	Restrict        *bool                           `json:"restrict,omitempty"`
	Ip              *string                         `json:"ip,omitempty"`
	Net             *string                         `json:"net,omitempty"`
	Host            *string                         `json:"host,omitempty"`
	Tftp            *string                         `json:"tftp,omitempty"`
	Bootfile        *string                         `json:"bootfile,omitempty"`
	Dhcpstart       *string                         `json:"dhcpstart,omitempty"`
	Dnssearch       []TypeN663                      `json:"dnssearch,omitempty"`
	Domainname      *string                         `json:"domainname,omitempty"`
	Ipv6Prefix      *string                         `json:"ipv6-prefix,omitempty"`
	Ipv6Prefixlen   *int64                          `json:"ipv6-prefixlen,omitempty"`
	Ipv6Host        *string                         `json:"ipv6-host,omitempty"`
	Ipv6Dns         *string                         `json:"ipv6-dns,omitempty"`
	Smb             *string                         `json:"smb,omitempty"`
	Smbserver       *string                         `json:"smbserver,omitempty"`
	Hostfwd         []TypeN664                      `json:"hostfwd,omitempty"`
	Guestfwd        []TypeN665                      `json:"guestfwd,omitempty"`
	TftpServerName  *string                         `json:"tftp-server-name,omitempty"`
	Ifname          *string                         `json:"ifname,omitempty"`
	Fd              *string                         `json:"fd,omitempty"`
	Fds             *string                         `json:"fds,omitempty"`
	Script          *string                         `json:"script,omitempty"`
	Downscript      *string                         `json:"downscript,omitempty"`
	Br              *string                         `json:"br,omitempty"`
	Helper          *string                         `json:"helper,omitempty"`
	Sndbuf          *int64                          `json:"sndbuf,omitempty"`
	VnetHdr         *bool                           `json:"vnet_hdr,omitempty"`
	Vhost           *bool                           `json:"vhost,omitempty"`
	Vhostfd         *string                         `json:"vhostfd,omitempty"`
	Vhostfds        *string                         `json:"vhostfds,omitempty"`
	Vhostforce      *bool                           `json:"vhostforce,omitempty"`
	Queues          *int64                          `json:"queues,omitempty"`
	PollUs          *int64                          `json:"poll-us,omitempty"`
	Src             *string                         `json:"src,omitempty"`
	Dst             *string                         `json:"dst,omitempty"`
	Srcport         *string                         `json:"srcport,omitempty"`
	Dstport         *string                         `json:"dstport,omitempty"`
	Cookie64        *bool                           `json:"cookie64,omitempty"`
	Counter         *bool                           `json:"counter,omitempty"`
	Pincounter      *bool                           `json:"pincounter,omitempty"`
	Txcookie        *int64                          `json:"txcookie,omitempty"`
	Rxcookie        *int64                          `json:"rxcookie,omitempty"`
	Txsession       *int64                          `json:"txsession,omitempty"`
	Rxsession       *int64                          `json:"rxsession,omitempty"`
	Offset          *int64                          `json:"offset,omitempty"`
	Listen          *string                         `json:"listen,omitempty"`
	Connect         *string                         `json:"connect,omitempty"`
	Mcast           *string                         `json:"mcast,omitempty"`
	Localaddr       *string                         `json:"localaddr,omitempty"`
	Server          *bool                           `json:"server,omitempty"`
	ReconnectMs     *int64                          `json:"reconnect-ms,omitempty"`
	Local           *NETDEVSTREAMCONNECTEDEventAddr `json:"local,omitempty"`
	Remote          *NETDEVSTREAMCONNECTEDEventAddr `json:"remote,omitempty"`
	Sock            *string                         `json:"sock,omitempty"`
	Port            *int64                          `json:"port,omitempty"`
	Group           *string                         `json:"group,omitempty"`
	Mode            any                             `json:"mode,omitempty"`
	Hubid           *int64                          `json:"hubid,omitempty"`
	Devname         *string                         `json:"devname,omitempty"`
	ForceCopy       *bool                           `json:"force-copy,omitempty"`
	StartQueue      *int64                          `json:"start-queue,omitempty"`
	Inhibit         *bool                           `json:"inhibit,omitempty"`
	SockFds         *string                         `json:"sock-fds,omitempty"`
	MapPath         *string                         `json:"map-path,omitempty"`
	MapStartIndex   *int64                          `json:"map-start-index,omitempty"`
	Chardev         *string                         `json:"chardev,omitempty"`
	Vhostdev        *string                         `json:"vhostdev,omitempty"`
	XSvq            *bool                           `json:"x-svq,omitempty"`
}

// NetdevAddArgsAfXdp is QAPI object 396.
type NetdevAddArgsAfXdp struct {
	Ifname        string                  `json:"ifname"`
	Mode          *NetdevAddArgsAfXdpMode `json:"mode,omitempty"`
	ForceCopy     *bool                   `json:"force-copy,omitempty"`
	Queues        *int64                  `json:"queues,omitempty"`
	StartQueue    *int64                  `json:"start-queue,omitempty"`
	Inhibit       *bool                   `json:"inhibit,omitempty"`
	SockFds       *string                 `json:"sock-fds,omitempty"`
	MapPath       *string                 `json:"map-path,omitempty"`
	MapStartIndex *int64                  `json:"map-start-index,omitempty"`
}

// NetdevAddArgsBridge is QAPI object 393.
type NetdevAddArgsBridge struct {
	Br     *string `json:"br,omitempty"`
	Helper *string `json:"helper,omitempty"`
}

// NetdevAddArgsDgram is QAPI object 391.
type NetdevAddArgsDgram struct {
	Local  *NETDEVSTREAMCONNECTEDEventAddr `json:"local,omitempty"`
	Remote *NETDEVSTREAMCONNECTEDEventAddr `json:"remote,omitempty"`
}

// NetdevAddArgsHubport is QAPI object 394.
type NetdevAddArgsHubport struct {
	Hubid  int64   `json:"hubid"`
	Netdev *string `json:"netdev,omitempty"`
}

// NetdevAddArgsL2tpv3 is QAPI object 388.
type NetdevAddArgsL2tpv3 struct {
	Src        string  `json:"src"`
	Dst        string  `json:"dst"`
	Srcport    *string `json:"srcport,omitempty"`
	Dstport    *string `json:"dstport,omitempty"`
	Ipv6       *bool   `json:"ipv6,omitempty"`
	Udp        *bool   `json:"udp,omitempty"`
	Cookie64   *bool   `json:"cookie64,omitempty"`
	Counter    *bool   `json:"counter,omitempty"`
	Pincounter *bool   `json:"pincounter,omitempty"`
	Txcookie   *int64  `json:"txcookie,omitempty"`
	Rxcookie   *int64  `json:"rxcookie,omitempty"`
	Txsession  int64   `json:"txsession"`
	Rxsession  *int64  `json:"rxsession,omitempty"`
	Offset     *int64  `json:"offset,omitempty"`
}

// NetdevAddArgsNetmap is QAPI object 395.
type NetdevAddArgsNetmap struct {
	Ifname  string  `json:"ifname"`
	Devname *string `json:"devname,omitempty"`
}

// NetdevAddArgsNic is QAPI object 384.
type NetdevAddArgsNic struct {
	Netdev  *string `json:"netdev,omitempty"`
	Macaddr *string `json:"macaddr,omitempty"`
	Model   *string `json:"model,omitempty"`
	Addr    *string `json:"addr,omitempty"`
	Vectors *int64  `json:"vectors,omitempty"`
}

// NetdevAddArgsPasst is QAPI object 385.
type NetdevAddArgsPasst struct {
	Path            *string    `json:"path,omitempty"`
	Quiet           *bool      `json:"quiet,omitempty"`
	VhostUser       *bool      `json:"vhost-user,omitempty"`
	Mtu             *int64     `json:"mtu,omitempty"`
	Address         *string    `json:"address,omitempty"`
	Netmask         *string    `json:"netmask,omitempty"`
	Mac             *string    `json:"mac,omitempty"`
	Gateway         *string    `json:"gateway,omitempty"`
	Interface_      *string    `json:"interface,omitempty"`
	Outbound        *string    `json:"outbound,omitempty"`
	OutboundIf4     *string    `json:"outbound-if4,omitempty"`
	OutboundIf6     *string    `json:"outbound-if6,omitempty"`
	Dns             *string    `json:"dns,omitempty"`
	Search          []TypeN660 `json:"search,omitempty"`
	Fqdn            *string    `json:"fqdn,omitempty"`
	DhcpDns         *bool      `json:"dhcp-dns,omitempty"`
	DhcpSearch      *bool      `json:"dhcp-search,omitempty"`
	MapHostLoopback *string    `json:"map-host-loopback,omitempty"`
	MapGuestAddr    *string    `json:"map-guest-addr,omitempty"`
	DnsForward      *string    `json:"dns-forward,omitempty"`
	DnsHost         *string    `json:"dns-host,omitempty"`
	Tcp             *bool      `json:"tcp,omitempty"`
	Udp             *bool      `json:"udp,omitempty"`
	Icmp            *bool      `json:"icmp,omitempty"`
	Dhcp            *bool      `json:"dhcp,omitempty"`
	Ndp             *bool      `json:"ndp,omitempty"`
	Dhcpv6          *bool      `json:"dhcpv6,omitempty"`
	Ra              *bool      `json:"ra,omitempty"`
	Freebind        *bool      `json:"freebind,omitempty"`
	Ipv4            *bool      `json:"ipv4,omitempty"`
	Ipv6            *bool      `json:"ipv6,omitempty"`
	TcpPorts        []TypeN661 `json:"tcp-ports,omitempty"`
	UdpPorts        []TypeN661 `json:"udp-ports,omitempty"`
	Param           []TypeN662 `json:"param,omitempty"`
}

// NetdevAddArgsSocket is QAPI object 389.
type NetdevAddArgsSocket struct {
	Fd        *string `json:"fd,omitempty"`
	Listen    *string `json:"listen,omitempty"`
	Connect   *string `json:"connect,omitempty"`
	Mcast     *string `json:"mcast,omitempty"`
	Localaddr *string `json:"localaddr,omitempty"`
	Udp       *string `json:"udp,omitempty"`
}

// NetdevAddArgsStream is QAPI object 390.
type NetdevAddArgsStream struct {
	Addr        NETDEVSTREAMCONNECTEDEventAddr `json:"addr"`
	Server      *bool                          `json:"server,omitempty"`
	ReconnectMs *int64                         `json:"reconnect-ms,omitempty"`
}

// NetdevAddArgsTap is QAPI object 387.
type NetdevAddArgsTap struct {
	Ifname     *string `json:"ifname,omitempty"`
	Fd         *string `json:"fd,omitempty"`
	Fds        *string `json:"fds,omitempty"`
	Script     *string `json:"script,omitempty"`
	Downscript *string `json:"downscript,omitempty"`
	Br         *string `json:"br,omitempty"`
	Helper     *string `json:"helper,omitempty"`
	Sndbuf     *int64  `json:"sndbuf,omitempty"`
	VnetHdr    *bool   `json:"vnet_hdr,omitempty"`
	Vhost      *bool   `json:"vhost,omitempty"`
	Vhostfd    *string `json:"vhostfd,omitempty"`
	Vhostfds   *string `json:"vhostfds,omitempty"`
	Vhostforce *bool   `json:"vhostforce,omitempty"`
	Queues     *int64  `json:"queues,omitempty"`
	PollUs     *int64  `json:"poll-us,omitempty"`
}

// NetdevAddArgsUser is QAPI object 386.
type NetdevAddArgsUser struct {
	Hostname       *string    `json:"hostname,omitempty"`
	Restrict       *bool      `json:"restrict,omitempty"`
	Ipv4           *bool      `json:"ipv4,omitempty"`
	Ipv6           *bool      `json:"ipv6,omitempty"`
	Ip             *string    `json:"ip,omitempty"`
	Net            *string    `json:"net,omitempty"`
	Host           *string    `json:"host,omitempty"`
	Tftp           *string    `json:"tftp,omitempty"`
	Bootfile       *string    `json:"bootfile,omitempty"`
	Dhcpstart      *string    `json:"dhcpstart,omitempty"`
	Dns            *string    `json:"dns,omitempty"`
	Dnssearch      []TypeN663 `json:"dnssearch,omitempty"`
	Domainname     *string    `json:"domainname,omitempty"`
	Ipv6Prefix     *string    `json:"ipv6-prefix,omitempty"`
	Ipv6Prefixlen  *int64     `json:"ipv6-prefixlen,omitempty"`
	Ipv6Host       *string    `json:"ipv6-host,omitempty"`
	Ipv6Dns        *string    `json:"ipv6-dns,omitempty"`
	Smb            *string    `json:"smb,omitempty"`
	Smbserver      *string    `json:"smbserver,omitempty"`
	Hostfwd        []TypeN664 `json:"hostfwd,omitempty"`
	Guestfwd       []TypeN665 `json:"guestfwd,omitempty"`
	TftpServerName *string    `json:"tftp-server-name,omitempty"`
}

// NetdevAddArgsVde is QAPI object 392.
type NetdevAddArgsVde struct {
	Sock  *string `json:"sock,omitempty"`
	Port  *int64  `json:"port,omitempty"`
	Group *string `json:"group,omitempty"`
	Mode  *int64  `json:"mode,omitempty"`
}

// NetdevAddArgsVhostUser is QAPI object 397.
type NetdevAddArgsVhostUser struct {
	Chardev    string `json:"chardev"`
	Vhostforce *bool  `json:"vhostforce,omitempty"`
	Queues     *int64 `json:"queues,omitempty"`
}

// NetdevAddArgsVhostVdpa is QAPI object 398.
type NetdevAddArgsVhostVdpa struct {
	Vhostdev *string `json:"vhostdev,omitempty"`
	Vhostfd  *string `json:"vhostfd,omitempty"`
	Queues   *int64  `json:"queues,omitempty"`
	XSvq     *bool   `json:"x-svq,omitempty"`
}

// NetdevDelArgs is QAPI object 107.
type NetdevDelArgs struct {
	Id string `json:"id"`
}

// ObjectAddArgs is QAPI object 194.
type ObjectAddArgs struct {
	QomType                        ObjectAddArgsQomType                `json:"qom-type"`
	Id                             string                              `json:"id"`
	PciDev                         *string                             `json:"pci-dev,omitempty"`
	Node                           *int64                              `json:"node,omitempty"`
	PciBus                         *string                             `json:"pci-bus,omitempty"`
	Policy                         any                                 `json:"policy,omitempty"`
	Rules                          []TypeN701                          `json:"rules,omitempty"`
	Filename                       *string                             `json:"filename,omitempty"`
	Refresh                        *bool                               `json:"refresh,omitempty"`
	Service                        *string                             `json:"service,omitempty"`
	Identity                       *string                             `json:"identity,omitempty"`
	If_                            *string                             `json:"if,omitempty"`
	Canbus                         *string                             `json:"canbus,omitempty"`
	PrimaryIn                      *string                             `json:"primary_in,omitempty"`
	SecondaryIn                    *string                             `json:"secondary_in,omitempty"`
	Outdev                         *string                             `json:"outdev,omitempty"`
	Iothread                       *string                             `json:"iothread,omitempty"`
	NotifyDev                      *string                             `json:"notify_dev,omitempty"`
	CompareTimeout                 *int64                              `json:"compare_timeout,omitempty"`
	ExpiredScanCycle               *int64                              `json:"expired_scan_cycle,omitempty"`
	MaxQueueSize                   *int64                              `json:"max_queue_size,omitempty"`
	VnetHdrSupport                 *bool                               `json:"vnet_hdr_support,omitempty"`
	Queues                         *int64                              `json:"queues,omitempty"`
	ThrottleBps                    *int64                              `json:"throttle-bps,omitempty"`
	ThrottleOps                    *int64                              `json:"throttle-ops,omitempty"`
	Chardev                        *string                             `json:"chardev,omitempty"`
	Addr                           *string                             `json:"addr,omitempty"`
	IdList                         *string                             `json:"id-list,omitempty"`
	Netdev                         *string                             `json:"netdev,omitempty"`
	Queue                          *ObjectAddArgsFilterBufferQueue     `json:"queue,omitempty"`
	Status                         *string                             `json:"status,omitempty"`
	Position                       *string                             `json:"position,omitempty"`
	Insert                         *ObjectAddArgsFilterBufferInsert    `json:"insert,omitempty"`
	Interval                       *int64                              `json:"interval,omitempty"`
	File                           *string                             `json:"file,omitempty"`
	Maxlen                         *int64                              `json:"maxlen,omitempty"`
	Indev                          *string                             `json:"indev,omitempty"`
	Name                           *string                             `json:"name,omitempty"`
	Server                         *string                             `json:"server,omitempty"`
	Port                           *string                             `json:"port,omitempty"`
	XOrigin                        *string                             `json:"x-origin,omitempty"`
	YOrigin                        *string                             `json:"y-origin,omitempty"`
	Width                          *string                             `json:"width,omitempty"`
	Height                         *string                             `json:"height,omitempty"`
	Evdev                          *string                             `json:"evdev,omitempty"`
	GrabAll                        *bool                               `json:"grab_all,omitempty"`
	Repeat                         *bool                               `json:"repeat,omitempty"`
	GrabToggle                     *ObjectAddArgsInputLinuxGrabToggle  `json:"grab-toggle,omitempty"`
	Fd                             *string                             `json:"fd,omitempty"`
	AioMaxBatch                    *int64                              `json:"aio-max-batch,omitempty"`
	ThreadPoolMin                  *int64                              `json:"thread-pool-min,omitempty"`
	ThreadPoolMax                  *int64                              `json:"thread-pool-max,omitempty"`
	PollMaxNs                      *int64                              `json:"poll-max-ns,omitempty"`
	PollGrow                       *int64                              `json:"poll-grow,omitempty"`
	PollShrink                     *int64                              `json:"poll-shrink,omitempty"`
	PollWeight                     *int64                              `json:"poll-weight,omitempty"`
	Dump                           *bool                               `json:"dump,omitempty"`
	HostNodes                      []int64                             `json:"host-nodes,omitempty"`
	Merge                          *bool                               `json:"merge,omitempty"`
	Prealloc                       *bool                               `json:"prealloc,omitempty"`
	PreallocThreads                *int64                              `json:"prealloc-threads,omitempty"`
	PreallocContext                *string                             `json:"prealloc-context,omitempty"`
	Share                          *bool                               `json:"share,omitempty"`
	Reserve                        *bool                               `json:"reserve,omitempty"`
	Size                           *int64                              `json:"size,omitempty"`
	XUseCanonicalPathForRamblockId *bool                               `json:"x-use-canonical-path-for-ramblock-id,omitempty"`
	Align                          *int64                              `json:"align,omitempty"`
	Offset                         *int64                              `json:"offset,omitempty"`
	DiscardData                    *bool                               `json:"discard-data,omitempty"`
	MemPath                        *string                             `json:"mem-path,omitempty"`
	Readonly                       *bool                               `json:"readonly,omitempty"`
	Rom                            *BlockdevAddArgsFileLocking         `json:"rom,omitempty"`
	Hugetlb                        *bool                               `json:"hugetlb,omitempty"`
	Hugetlbsize                    *int64                              `json:"hugetlbsize,omitempty"`
	Seal                           *bool                               `json:"seal,omitempty"`
	Readline                       *bool                               `json:"readline,omitempty"`
	Pretty                         *bool                               `json:"pretty,omitempty"`
	CloseAction                    *ObjectAddArgsMonitorQmpCloseAction `json:"close-action,omitempty"`
	Path                           *string                             `json:"path,omitempty"`
	Log                            *string                             `json:"log,omitempty"`
	Opened                         *bool                               `json:"opened,omitempty"`
	Format                         *ObjectAddArgsSecretFormat          `json:"format,omitempty"`
	Keyid                          *string                             `json:"keyid,omitempty"`
	Iv                             *string                             `json:"iv,omitempty"`
	Data                           *string                             `json:"data,omitempty"`
	Serial                         *int64                              `json:"serial,omitempty"`
	SevDevice                      *string                             `json:"sev-device,omitempty"`
	Cbitpos                        *int64                              `json:"cbitpos,omitempty"`
	ReducedPhysBits                *int64                              `json:"reduced-phys-bits,omitempty"`
	KernelHashes                   *bool                               `json:"kernel-hashes,omitempty"`
	DhCertFile                     *string                             `json:"dh-cert-file,omitempty"`
	SessionFile                    *string                             `json:"session-file,omitempty"`
	Handle                         *int64                              `json:"handle,omitempty"`
	LegacyVmType                   *BlockdevAddArgsFileLocking         `json:"legacy-vm-type,omitempty"`
	GuestVisibleWorkarounds        *string                             `json:"guest-visible-workarounds,omitempty"`
	IdBlock                        *string                             `json:"id-block,omitempty"`
	IdAuth                         *string                             `json:"id-auth,omitempty"`
	AuthorKeyEnabled               *bool                               `json:"author-key-enabled,omitempty"`
	HostData                       *string                             `json:"host-data,omitempty"`
	VcekDisabled                   *bool                               `json:"vcek-disabled,omitempty"`
	Attributes                     *int64                              `json:"attributes,omitempty"`
	SeptVeDisable                  *bool                               `json:"sept-ve-disable,omitempty"`
	Mrconfigid                     *string                             `json:"mrconfigid,omitempty"`
	Mrowner                        *string                             `json:"mrowner,omitempty"`
	Mrownerconfig                  *string                             `json:"mrownerconfig,omitempty"`
	QuoteGenerationSocket          *NETDEVSTREAMCONNECTEDEventAddr     `json:"quote-generation-socket,omitempty"`
	CpuAffinity                    []int64                             `json:"cpu-affinity,omitempty"`
	NodeAffinity                   []int64                             `json:"node-affinity,omitempty"`
	Limits                         *ObjectAddArgsThrottleGroupLimits   `json:"limits,omitempty"`
	XIopsTotal                     *int64                              `json:"x-iops-total,omitempty"`
	XIopsTotalMax                  *int64                              `json:"x-iops-total-max,omitempty"`
	XIopsTotalMaxLength            *int64                              `json:"x-iops-total-max-length,omitempty"`
	XIopsRead                      *int64                              `json:"x-iops-read,omitempty"`
	XIopsReadMax                   *int64                              `json:"x-iops-read-max,omitempty"`
	XIopsReadMaxLength             *int64                              `json:"x-iops-read-max-length,omitempty"`
	XIopsWrite                     *int64                              `json:"x-iops-write,omitempty"`
	XIopsWriteMax                  *int64                              `json:"x-iops-write-max,omitempty"`
	XIopsWriteMaxLength            *int64                              `json:"x-iops-write-max-length,omitempty"`
	XBpsTotal                      *int64                              `json:"x-bps-total,omitempty"`
	XBpsTotalMax                   *int64                              `json:"x-bps-total-max,omitempty"`
	XBpsTotalMaxLength             *int64                              `json:"x-bps-total-max-length,omitempty"`
	XBpsRead                       *int64                              `json:"x-bps-read,omitempty"`
	XBpsReadMax                    *int64                              `json:"x-bps-read-max,omitempty"`
	XBpsReadMaxLength              *int64                              `json:"x-bps-read-max-length,omitempty"`
	XBpsWrite                      *int64                              `json:"x-bps-write,omitempty"`
	XBpsWriteMax                   *int64                              `json:"x-bps-write-max,omitempty"`
	XBpsWriteMaxLength             *int64                              `json:"x-bps-write-max-length,omitempty"`
	XIopsSize                      *int64                              `json:"x-iops-size,omitempty"`
	VerifyPeer                     *bool                               `json:"verify-peer,omitempty"`
	Dir                            *string                             `json:"dir,omitempty"`
	Endpoint                       *ObjectAddArgsTlsCredsAnonEndpoint  `json:"endpoint,omitempty"`
	Priority                       *string                             `json:"priority,omitempty"`
	Username                       *string                             `json:"username,omitempty"`
	SanityCheck                    *bool                               `json:"sanity-check,omitempty"`
	Passwordid                     *string                             `json:"passwordid,omitempty"`
	Devid                          *string                             `json:"devid,omitempty"`
	Socket                         *NETDEVSTREAMCONNECTEDEventAddr     `json:"socket,omitempty"`
	Device                         *string                             `json:"device,omitempty"`
}

// ObjectAddArgsAcpiGenericInitiator is QAPI object 472.
type ObjectAddArgsAcpiGenericInitiator struct {
	PciDev string `json:"pci-dev"`
	Node   int64  `json:"node"`
}

// ObjectAddArgsAcpiGenericPort is QAPI object 473.
type ObjectAddArgsAcpiGenericPort struct {
	PciBus string `json:"pci-bus"`
	Node   int64  `json:"node"`
}

// ObjectAddArgsAuthzList is QAPI object 474.
type ObjectAddArgsAuthzList struct {
	Policy *ObjectAddArgsAuthzListPolicy `json:"policy,omitempty"`
	Rules  []TypeN701                    `json:"rules,omitempty"`
}

// ObjectAddArgsAuthzListfile is QAPI object 475.
type ObjectAddArgsAuthzListfile struct {
	Filename string `json:"filename"`
	Refresh  *bool  `json:"refresh,omitempty"`
}

// ObjectAddArgsAuthzPam is QAPI object 476.
type ObjectAddArgsAuthzPam struct {
	Service string `json:"service"`
}

// ObjectAddArgsAuthzSimple is QAPI object 477.
type ObjectAddArgsAuthzSimple struct {
	Identity string `json:"identity"`
}

// ObjectAddArgsCanHostSocketcan is QAPI object 478.
type ObjectAddArgsCanHostSocketcan struct {
	If_    string `json:"if"`
	Canbus string `json:"canbus"`
}

// ObjectAddArgsColoCompare is QAPI object 479.
type ObjectAddArgsColoCompare struct {
	PrimaryIn        string  `json:"primary_in"`
	SecondaryIn      string  `json:"secondary_in"`
	Outdev           string  `json:"outdev"`
	Iothread         string  `json:"iothread"`
	NotifyDev        *string `json:"notify_dev,omitempty"`
	CompareTimeout   *int64  `json:"compare_timeout,omitempty"`
	ExpiredScanCycle *int64  `json:"expired_scan_cycle,omitempty"`
	MaxQueueSize     *int64  `json:"max_queue_size,omitempty"`
	VnetHdrSupport   *bool   `json:"vnet_hdr_support,omitempty"`
}

// ObjectAddArgsCryptodevBackend is QAPI object 480.
type ObjectAddArgsCryptodevBackend struct {
	Queues      *int64 `json:"queues,omitempty"`
	ThrottleBps *int64 `json:"throttle-bps,omitempty"`
	ThrottleOps *int64 `json:"throttle-ops,omitempty"`
}

// ObjectAddArgsCryptodevVhostUser is QAPI object 481.
type ObjectAddArgsCryptodevVhostUser struct {
	Queues      *int64 `json:"queues,omitempty"`
	ThrottleBps *int64 `json:"throttle-bps,omitempty"`
	ThrottleOps *int64 `json:"throttle-ops,omitempty"`
	Chardev     string `json:"chardev"`
}

// ObjectAddArgsDbusVmstate is QAPI object 482.
type ObjectAddArgsDbusVmstate struct {
	Addr   string  `json:"addr"`
	IdList *string `json:"id-list,omitempty"`
}

// ObjectAddArgsFilterBuffer is QAPI object 483.
type ObjectAddArgsFilterBuffer struct {
	Netdev   string                           `json:"netdev"`
	Queue    *ObjectAddArgsFilterBufferQueue  `json:"queue,omitempty"`
	Status   *string                          `json:"status,omitempty"`
	Position *string                          `json:"position,omitempty"`
	Insert   *ObjectAddArgsFilterBufferInsert `json:"insert,omitempty"`
	Interval int64                            `json:"interval"`
}

// ObjectAddArgsFilterDump is QAPI object 484.
type ObjectAddArgsFilterDump struct {
	Netdev   string                           `json:"netdev"`
	Queue    *ObjectAddArgsFilterBufferQueue  `json:"queue,omitempty"`
	Status   *string                          `json:"status,omitempty"`
	Position *string                          `json:"position,omitempty"`
	Insert   *ObjectAddArgsFilterBufferInsert `json:"insert,omitempty"`
	File     string                           `json:"file"`
	Maxlen   *int64                           `json:"maxlen,omitempty"`
}

// ObjectAddArgsFilterMirror is QAPI object 485.
type ObjectAddArgsFilterMirror struct {
	Netdev         string                           `json:"netdev"`
	Queue          *ObjectAddArgsFilterBufferQueue  `json:"queue,omitempty"`
	Status         *string                          `json:"status,omitempty"`
	Position       *string                          `json:"position,omitempty"`
	Insert         *ObjectAddArgsFilterBufferInsert `json:"insert,omitempty"`
	Outdev         string                           `json:"outdev"`
	VnetHdrSupport *bool                            `json:"vnet_hdr_support,omitempty"`
}

// ObjectAddArgsFilterRedirector is QAPI object 486.
type ObjectAddArgsFilterRedirector struct {
	Netdev         string                           `json:"netdev"`
	Queue          *ObjectAddArgsFilterBufferQueue  `json:"queue,omitempty"`
	Status         *string                          `json:"status,omitempty"`
	Position       *string                          `json:"position,omitempty"`
	Insert         *ObjectAddArgsFilterBufferInsert `json:"insert,omitempty"`
	Indev          *string                          `json:"indev,omitempty"`
	Outdev         *string                          `json:"outdev,omitempty"`
	VnetHdrSupport *bool                            `json:"vnet_hdr_support,omitempty"`
}

// ObjectAddArgsFilterReplay is QAPI object 487.
type ObjectAddArgsFilterReplay struct {
	Netdev   string                           `json:"netdev"`
	Queue    *ObjectAddArgsFilterBufferQueue  `json:"queue,omitempty"`
	Status   *string                          `json:"status,omitempty"`
	Position *string                          `json:"position,omitempty"`
	Insert   *ObjectAddArgsFilterBufferInsert `json:"insert,omitempty"`
}

// ObjectAddArgsFilterRewriter is QAPI object 488.
type ObjectAddArgsFilterRewriter struct {
	Netdev         string                           `json:"netdev"`
	Queue          *ObjectAddArgsFilterBufferQueue  `json:"queue,omitempty"`
	Status         *string                          `json:"status,omitempty"`
	Position       *string                          `json:"position,omitempty"`
	Insert         *ObjectAddArgsFilterBufferInsert `json:"insert,omitempty"`
	VnetHdrSupport *bool                            `json:"vnet_hdr_support,omitempty"`
}

// ObjectAddArgsInputBarrier is QAPI object 490.
type ObjectAddArgsInputBarrier struct {
	Name    string  `json:"name"`
	Server  *string `json:"server,omitempty"`
	Port    *string `json:"port,omitempty"`
	XOrigin *string `json:"x-origin,omitempty"`
	YOrigin *string `json:"y-origin,omitempty"`
	Width   *string `json:"width,omitempty"`
	Height  *string `json:"height,omitempty"`
}

// ObjectAddArgsInputLinux is QAPI object 491.
type ObjectAddArgsInputLinux struct {
	Evdev      string                             `json:"evdev"`
	GrabAll    *bool                              `json:"grab_all,omitempty"`
	Repeat     *bool                              `json:"repeat,omitempty"`
	GrabToggle *ObjectAddArgsInputLinuxGrabToggle `json:"grab-toggle,omitempty"`
}

// ObjectAddArgsIommufd is QAPI object 492.
type ObjectAddArgsIommufd struct {
	Fd *string `json:"fd,omitempty"`
}

// ObjectAddArgsIothread is QAPI object 493.
type ObjectAddArgsIothread struct {
	AioMaxBatch   *int64 `json:"aio-max-batch,omitempty"`
	ThreadPoolMin *int64 `json:"thread-pool-min,omitempty"`
	ThreadPoolMax *int64 `json:"thread-pool-max,omitempty"`
	PollMaxNs     *int64 `json:"poll-max-ns,omitempty"`
	PollGrow      *int64 `json:"poll-grow,omitempty"`
	PollShrink    *int64 `json:"poll-shrink,omitempty"`
	PollWeight    *int64 `json:"poll-weight,omitempty"`
}

// ObjectAddArgsMainLoop is QAPI object 494.
type ObjectAddArgsMainLoop struct {
	AioMaxBatch   *int64 `json:"aio-max-batch,omitempty"`
	ThreadPoolMin *int64 `json:"thread-pool-min,omitempty"`
	ThreadPoolMax *int64 `json:"thread-pool-max,omitempty"`
}

// ObjectAddArgsMemoryBackendEpc is QAPI object 495.
type ObjectAddArgsMemoryBackendEpc struct {
	Dump                           *bool                                `json:"dump,omitempty"`
	HostNodes                      []int64                              `json:"host-nodes,omitempty"`
	Merge                          *bool                                `json:"merge,omitempty"`
	Policy                         *ObjectAddArgsMemoryBackendEpcPolicy `json:"policy,omitempty"`
	Prealloc                       *bool                                `json:"prealloc,omitempty"`
	PreallocThreads                *int64                               `json:"prealloc-threads,omitempty"`
	PreallocContext                *string                              `json:"prealloc-context,omitempty"`
	Share                          *bool                                `json:"share,omitempty"`
	Reserve                        *bool                                `json:"reserve,omitempty"`
	Size                           int64                                `json:"size"`
	XUseCanonicalPathForRamblockId *bool                                `json:"x-use-canonical-path-for-ramblock-id,omitempty"`
}

// ObjectAddArgsMemoryBackendFile is QAPI object 496.
type ObjectAddArgsMemoryBackendFile struct {
	Dump                           *bool                                `json:"dump,omitempty"`
	HostNodes                      []int64                              `json:"host-nodes,omitempty"`
	Merge                          *bool                                `json:"merge,omitempty"`
	Policy                         *ObjectAddArgsMemoryBackendEpcPolicy `json:"policy,omitempty"`
	Prealloc                       *bool                                `json:"prealloc,omitempty"`
	PreallocThreads                *int64                               `json:"prealloc-threads,omitempty"`
	PreallocContext                *string                              `json:"prealloc-context,omitempty"`
	Share                          *bool                                `json:"share,omitempty"`
	Reserve                        *bool                                `json:"reserve,omitempty"`
	Size                           int64                                `json:"size"`
	XUseCanonicalPathForRamblockId *bool                                `json:"x-use-canonical-path-for-ramblock-id,omitempty"`
	Align                          *int64                               `json:"align,omitempty"`
	Offset                         *int64                               `json:"offset,omitempty"`
	DiscardData                    *bool                                `json:"discard-data,omitempty"`
	MemPath                        string                               `json:"mem-path"`
	Readonly                       *bool                                `json:"readonly,omitempty"`
	Rom                            *BlockdevAddArgsFileLocking          `json:"rom,omitempty"`
}

// ObjectAddArgsMemoryBackendMemfd is QAPI object 497.
type ObjectAddArgsMemoryBackendMemfd struct {
	Dump                           *bool                                `json:"dump,omitempty"`
	HostNodes                      []int64                              `json:"host-nodes,omitempty"`
	Merge                          *bool                                `json:"merge,omitempty"`
	Policy                         *ObjectAddArgsMemoryBackendEpcPolicy `json:"policy,omitempty"`
	Prealloc                       *bool                                `json:"prealloc,omitempty"`
	PreallocThreads                *int64                               `json:"prealloc-threads,omitempty"`
	PreallocContext                *string                              `json:"prealloc-context,omitempty"`
	Share                          *bool                                `json:"share,omitempty"`
	Reserve                        *bool                                `json:"reserve,omitempty"`
	Size                           int64                                `json:"size"`
	XUseCanonicalPathForRamblockId *bool                                `json:"x-use-canonical-path-for-ramblock-id,omitempty"`
	Hugetlb                        *bool                                `json:"hugetlb,omitempty"`
	Hugetlbsize                    *int64                               `json:"hugetlbsize,omitempty"`
	Seal                           *bool                                `json:"seal,omitempty"`
}

// ObjectAddArgsMemoryBackendRam is QAPI object 498.
type ObjectAddArgsMemoryBackendRam struct {
	Dump                           *bool                                `json:"dump,omitempty"`
	HostNodes                      []int64                              `json:"host-nodes,omitempty"`
	Merge                          *bool                                `json:"merge,omitempty"`
	Policy                         *ObjectAddArgsMemoryBackendEpcPolicy `json:"policy,omitempty"`
	Prealloc                       *bool                                `json:"prealloc,omitempty"`
	PreallocThreads                *int64                               `json:"prealloc-threads,omitempty"`
	PreallocContext                *string                              `json:"prealloc-context,omitempty"`
	Share                          *bool                                `json:"share,omitempty"`
	Reserve                        *bool                                `json:"reserve,omitempty"`
	Size                           int64                                `json:"size"`
	XUseCanonicalPathForRamblockId *bool                                `json:"x-use-canonical-path-for-ramblock-id,omitempty"`
}

// ObjectAddArgsMemoryBackendShm is QAPI object 499.
type ObjectAddArgsMemoryBackendShm struct {
	Dump                           *bool                                `json:"dump,omitempty"`
	HostNodes                      []int64                              `json:"host-nodes,omitempty"`
	Merge                          *bool                                `json:"merge,omitempty"`
	Policy                         *ObjectAddArgsMemoryBackendEpcPolicy `json:"policy,omitempty"`
	Prealloc                       *bool                                `json:"prealloc,omitempty"`
	PreallocThreads                *int64                               `json:"prealloc-threads,omitempty"`
	PreallocContext                *string                              `json:"prealloc-context,omitempty"`
	Share                          *bool                                `json:"share,omitempty"`
	Reserve                        *bool                                `json:"reserve,omitempty"`
	Size                           int64                                `json:"size"`
	XUseCanonicalPathForRamblockId *bool                                `json:"x-use-canonical-path-for-ramblock-id,omitempty"`
}

// ObjectAddArgsMonitorHmp is QAPI object 500.
type ObjectAddArgsMonitorHmp struct {
	Chardev  string `json:"chardev"`
	Readline *bool  `json:"readline,omitempty"`
}

// ObjectAddArgsMonitorQmp is QAPI object 501.
type ObjectAddArgsMonitorQmp struct {
	Chardev     string                              `json:"chardev"`
	Pretty      *bool                               `json:"pretty,omitempty"`
	CloseAction *ObjectAddArgsMonitorQmpCloseAction `json:"close-action,omitempty"`
}

// ObjectAddArgsPrManagerHelper is QAPI object 502.
type ObjectAddArgsPrManagerHelper struct {
	Path string `json:"path"`
}

// ObjectAddArgsQtest is QAPI object 503.
type ObjectAddArgsQtest struct {
	Chardev string  `json:"chardev"`
	Log     *string `json:"log,omitempty"`
}

// ObjectAddArgsRngBuiltin is QAPI object 504.
type ObjectAddArgsRngBuiltin struct {
	Opened *bool `json:"opened,omitempty"`
}

// ObjectAddArgsRngEgd is QAPI object 505.
type ObjectAddArgsRngEgd struct {
	Opened  *bool  `json:"opened,omitempty"`
	Chardev string `json:"chardev"`
}

// ObjectAddArgsRngRandom is QAPI object 506.
type ObjectAddArgsRngRandom struct {
	Opened   *bool   `json:"opened,omitempty"`
	Filename *string `json:"filename,omitempty"`
}

// ObjectAddArgsSecret is QAPI object 507.
type ObjectAddArgsSecret struct {
	Format *ObjectAddArgsSecretFormat `json:"format,omitempty"`
	Keyid  *string                    `json:"keyid,omitempty"`
	Iv     *string                    `json:"iv,omitempty"`
	Data   *string                    `json:"data,omitempty"`
	File   *string                    `json:"file,omitempty"`
}

// ObjectAddArgsSecretKeyring is QAPI object 508.
type ObjectAddArgsSecretKeyring struct {
	Format *ObjectAddArgsSecretFormat `json:"format,omitempty"`
	Keyid  *string                    `json:"keyid,omitempty"`
	Iv     *string                    `json:"iv,omitempty"`
	Serial int64                      `json:"serial"`
}

// ObjectAddArgsSevGuest is QAPI object 509.
type ObjectAddArgsSevGuest struct {
	SevDevice       *string                     `json:"sev-device,omitempty"`
	Cbitpos         *int64                      `json:"cbitpos,omitempty"`
	ReducedPhysBits int64                       `json:"reduced-phys-bits"`
	KernelHashes    *bool                       `json:"kernel-hashes,omitempty"`
	DhCertFile      *string                     `json:"dh-cert-file,omitempty"`
	SessionFile     *string                     `json:"session-file,omitempty"`
	Policy          *int64                      `json:"policy,omitempty"`
	Handle          *int64                      `json:"handle,omitempty"`
	LegacyVmType    *BlockdevAddArgsFileLocking `json:"legacy-vm-type,omitempty"`
}

// ObjectAddArgsSevSnpGuest is QAPI object 510.
type ObjectAddArgsSevSnpGuest struct {
	SevDevice               *string `json:"sev-device,omitempty"`
	Cbitpos                 *int64  `json:"cbitpos,omitempty"`
	ReducedPhysBits         int64   `json:"reduced-phys-bits"`
	KernelHashes            *bool   `json:"kernel-hashes,omitempty"`
	Policy                  *int64  `json:"policy,omitempty"`
	GuestVisibleWorkarounds *string `json:"guest-visible-workarounds,omitempty"`
	IdBlock                 *string `json:"id-block,omitempty"`
	IdAuth                  *string `json:"id-auth,omitempty"`
	AuthorKeyEnabled        *bool   `json:"author-key-enabled,omitempty"`
	HostData                *string `json:"host-data,omitempty"`
	VcekDisabled            *bool   `json:"vcek-disabled,omitempty"`
}

// ObjectAddArgsTdxGuest is QAPI object 511.
type ObjectAddArgsTdxGuest struct {
	Attributes            *int64                          `json:"attributes,omitempty"`
	SeptVeDisable         *bool                           `json:"sept-ve-disable,omitempty"`
	Mrconfigid            *string                         `json:"mrconfigid,omitempty"`
	Mrowner               *string                         `json:"mrowner,omitempty"`
	Mrownerconfig         *string                         `json:"mrownerconfig,omitempty"`
	QuoteGenerationSocket *NETDEVSTREAMCONNECTEDEventAddr `json:"quote-generation-socket,omitempty"`
}

// ObjectAddArgsThreadContext is QAPI object 512.
type ObjectAddArgsThreadContext struct {
	CpuAffinity  []int64 `json:"cpu-affinity,omitempty"`
	NodeAffinity []int64 `json:"node-affinity,omitempty"`
}

// ObjectAddArgsThrottleGroup is QAPI object 513.
type ObjectAddArgsThrottleGroup struct {
	Limits              *ObjectAddArgsThrottleGroupLimits `json:"limits,omitempty"`
	XIopsTotal          *int64                            `json:"x-iops-total,omitempty"`
	XIopsTotalMax       *int64                            `json:"x-iops-total-max,omitempty"`
	XIopsTotalMaxLength *int64                            `json:"x-iops-total-max-length,omitempty"`
	XIopsRead           *int64                            `json:"x-iops-read,omitempty"`
	XIopsReadMax        *int64                            `json:"x-iops-read-max,omitempty"`
	XIopsReadMaxLength  *int64                            `json:"x-iops-read-max-length,omitempty"`
	XIopsWrite          *int64                            `json:"x-iops-write,omitempty"`
	XIopsWriteMax       *int64                            `json:"x-iops-write-max,omitempty"`
	XIopsWriteMaxLength *int64                            `json:"x-iops-write-max-length,omitempty"`
	XBpsTotal           *int64                            `json:"x-bps-total,omitempty"`
	XBpsTotalMax        *int64                            `json:"x-bps-total-max,omitempty"`
	XBpsTotalMaxLength  *int64                            `json:"x-bps-total-max-length,omitempty"`
	XBpsRead            *int64                            `json:"x-bps-read,omitempty"`
	XBpsReadMax         *int64                            `json:"x-bps-read-max,omitempty"`
	XBpsReadMaxLength   *int64                            `json:"x-bps-read-max-length,omitempty"`
	XBpsWrite           *int64                            `json:"x-bps-write,omitempty"`
	XBpsWriteMax        *int64                            `json:"x-bps-write-max,omitempty"`
	XBpsWriteMaxLength  *int64                            `json:"x-bps-write-max-length,omitempty"`
	XIopsSize           *int64                            `json:"x-iops-size,omitempty"`
}

// ObjectAddArgsThrottleGroupLimits is QAPI object 707.
type ObjectAddArgsThrottleGroupLimits struct {
	IopsTotal          *int64 `json:"iops-total,omitempty"`
	IopsTotalMax       *int64 `json:"iops-total-max,omitempty"`
	IopsTotalMaxLength *int64 `json:"iops-total-max-length,omitempty"`
	IopsRead           *int64 `json:"iops-read,omitempty"`
	IopsReadMax        *int64 `json:"iops-read-max,omitempty"`
	IopsReadMaxLength  *int64 `json:"iops-read-max-length,omitempty"`
	IopsWrite          *int64 `json:"iops-write,omitempty"`
	IopsWriteMax       *int64 `json:"iops-write-max,omitempty"`
	IopsWriteMaxLength *int64 `json:"iops-write-max-length,omitempty"`
	BpsTotal           *int64 `json:"bps-total,omitempty"`
	BpsTotalMax        *int64 `json:"bps-total-max,omitempty"`
	BpsTotalMaxLength  *int64 `json:"bps-total-max-length,omitempty"`
	BpsRead            *int64 `json:"bps-read,omitempty"`
	BpsReadMax         *int64 `json:"bps-read-max,omitempty"`
	BpsReadMaxLength   *int64 `json:"bps-read-max-length,omitempty"`
	BpsWrite           *int64 `json:"bps-write,omitempty"`
	BpsWriteMax        *int64 `json:"bps-write-max,omitempty"`
	BpsWriteMaxLength  *int64 `json:"bps-write-max-length,omitempty"`
	IopsSize           *int64 `json:"iops-size,omitempty"`
}

// ObjectAddArgsTlsCipherSuites is QAPI object 517.
type ObjectAddArgsTlsCipherSuites struct {
	VerifyPeer *bool                              `json:"verify-peer,omitempty"`
	Dir        *string                            `json:"dir,omitempty"`
	Endpoint   *ObjectAddArgsTlsCredsAnonEndpoint `json:"endpoint,omitempty"`
	Priority   *string                            `json:"priority,omitempty"`
}

// ObjectAddArgsTlsCredsAnon is QAPI object 514.
type ObjectAddArgsTlsCredsAnon struct {
	VerifyPeer *bool                              `json:"verify-peer,omitempty"`
	Dir        *string                            `json:"dir,omitempty"`
	Endpoint   *ObjectAddArgsTlsCredsAnonEndpoint `json:"endpoint,omitempty"`
	Priority   *string                            `json:"priority,omitempty"`
}

// ObjectAddArgsTlsCredsPsk is QAPI object 515.
type ObjectAddArgsTlsCredsPsk struct {
	VerifyPeer *bool                              `json:"verify-peer,omitempty"`
	Dir        *string                            `json:"dir,omitempty"`
	Endpoint   *ObjectAddArgsTlsCredsAnonEndpoint `json:"endpoint,omitempty"`
	Priority   *string                            `json:"priority,omitempty"`
	Username   *string                            `json:"username,omitempty"`
}

// ObjectAddArgsTlsCredsX509 is QAPI object 516.
type ObjectAddArgsTlsCredsX509 struct {
	VerifyPeer  *bool                              `json:"verify-peer,omitempty"`
	Dir         *string                            `json:"dir,omitempty"`
	Endpoint    *ObjectAddArgsTlsCredsAnonEndpoint `json:"endpoint,omitempty"`
	Priority    *string                            `json:"priority,omitempty"`
	SanityCheck *bool                              `json:"sanity-check,omitempty"`
	Passwordid  *string                            `json:"passwordid,omitempty"`
}

// ObjectAddArgsXRemoteObject is QAPI object 518.
type ObjectAddArgsXRemoteObject struct {
	Fd    string `json:"fd"`
	Devid string `json:"devid"`
}

// ObjectAddArgsXVfioUserServer is QAPI object 519.
type ObjectAddArgsXVfioUserServer struct {
	Socket NETDEVSTREAMCONNECTEDEventAddr `json:"socket"`
	Device string                         `json:"device"`
}

// ObjectDelArgs is QAPI object 195.
type ObjectDelArgs struct {
	Id string `json:"id"`
}

// PRMANAGERSTATUSCHANGEDEvent is QAPI object 29.
type PRMANAGERSTATUSCHANGEDEvent struct {
	Id        string `json:"id"`
	Connected bool   `json:"connected"`
}

// PmemsaveArgs is QAPI object 210.
type PmemsaveArgs struct {
	Val      int64  `json:"val"`
	Size     int64  `json:"size"`
	Filename string `json:"filename"`
}

// QUORUMFAILUREEvent is QAPI object 79.
type QUORUMFAILUREEvent struct {
	Reference    string `json:"reference"`
	SectorNum    int64  `json:"sector-num"`
	SectorsCount int64  `json:"sectors-count"`
}

// QUORUMREPORTBADEvent is QAPI object 80.
type QUORUMREPORTBADEvent struct {
	Type_        QUORUMREPORTBADEventType_ `json:"type"`
	Error        *string                   `json:"error,omitempty"`
	NodeName     string                    `json:"node-name"`
	SectorNum    int64                     `json:"sector-num"`
	SectorsCount int64                     `json:"sectors-count"`
}

// QmpCapabilitiesArgs is QAPI object 181.
type QmpCapabilitiesArgs struct {
	Enable []QMPCapability `json:"enable,omitempty"`
}

// QomGetArgs is QAPI object 187.
type QomGetArgs struct {
	Path     string `json:"path"`
	Property string `json:"property"`
}

// QomListArgs is QAPI object 185.
type QomListArgs struct {
	Path string `json:"path"`
}

// QomListGetArgs is QAPI object 188.
type QomListGetArgs struct {
	Paths []string `json:"paths"`
}

// QomListPropertiesArgs is QAPI object 193.
type QomListPropertiesArgs struct {
	Typename string `json:"typename"`
}

// QomListTypesArgs is QAPI object 191.
type QomListTypesArgs struct {
	Implements *string `json:"implements,omitempty"`
	Abstract   *bool   `json:"abstract,omitempty"`
}

// QomSetArgs is QAPI object 190.
type QomSetArgs struct {
	Path     string `json:"path"`
	Property string `json:"property"`
	Value    any    `json:"value"`
}

// QueryAcceleratorsResult is QAPI object 20.
type QueryAcceleratorsResult struct {
	Enabled QueryAcceleratorsResultEnabled   `json:"enabled"`
	Present []QueryAcceleratorsResultEnabled `json:"present"`
}

// QueryBalloonResult is QAPI object 215.
type QueryBalloonResult struct {
	Actual int64 `json:"actual"`
}

// QueryBlockArgs is QAPI object 32.
type QueryBlockArgs struct {
	Flat *bool `json:"flat,omitempty"`
}

// QueryBlockstatsArgs is QAPI object 34.
type QueryBlockstatsArgs struct {
	QueryNodes *bool `json:"query-nodes,omitempty"`
}

// QueryColoStatusResult is QAPI object 165.
type QueryColoStatusResult struct {
	Mode     COLOEXITEventMode   `json:"mode"`
	LastMode COLOEXITEventMode   `json:"last-mode"`
	Reason   COLOEXITEventReason `json:"reason"`
}

// QueryCommandLineOptionsArgs is QAPI object 251.
type QueryCommandLineOptionsArgs struct {
	Option *string `json:"option,omitempty"`
}

// QueryCpuModelBaselineArgs is QAPI object 227.
type QueryCpuModelBaselineArgs struct {
	Modela QueryCpuModelComparisonArgsModela `json:"modela"`
	Modelb QueryCpuModelComparisonArgsModela `json:"modelb"`
}

// QueryCpuModelBaselineResult is QAPI object 228.
type QueryCpuModelBaselineResult struct {
	Model QueryCpuModelComparisonArgsModela `json:"model"`
}

// QueryCpuModelComparisonArgs is QAPI object 225.
type QueryCpuModelComparisonArgs struct {
	Modela QueryCpuModelComparisonArgsModela `json:"modela"`
	Modelb QueryCpuModelComparisonArgsModela `json:"modelb"`
}

// QueryCpuModelComparisonArgsModela is QAPI object 538.
type QueryCpuModelComparisonArgsModela struct {
	Name  string `json:"name"`
	Props any    `json:"props,omitempty"`
}

// QueryCpuModelComparisonResult is QAPI object 226.
type QueryCpuModelComparisonResult struct {
	Result                QueryCpuModelComparisonResultResult `json:"result"`
	ResponsibleProperties []string                            `json:"responsible-properties"`
}

// QueryCpuModelExpansionArgs is QAPI object 229.
type QueryCpuModelExpansionArgs struct {
	Type_ QueryCpuModelExpansionArgsType_   `json:"type"`
	Model QueryCpuModelComparisonArgsModela `json:"model"`
}

// QueryCpuModelExpansionResult is QAPI object 230.
type QueryCpuModelExpansionResult struct {
	Model           QueryCpuModelComparisonArgsModela `json:"model"`
	DeprecatedProps []string                          `json:"deprecated-props,omitempty"`
}

// QueryCurrentMachineResult is QAPI object 205.
type QueryCurrentMachineResult struct {
	WakeupSuspendSupport bool `json:"wakeup-suspend-support"`
}

// QueryDirtyRateArgs is QAPI object 169.
type QueryDirtyRateArgs struct {
	CalcTimeUnit *CalcDirtyRateArgsCalcTimeUnit `json:"calc-time-unit,omitempty"`
}

// QueryDirtyRateResult is QAPI object 170.
type QueryDirtyRateResult struct {
	DirtyRate     *int64                        `json:"dirty-rate,omitempty"`
	Status        QueryDirtyRateResultStatus    `json:"status"`
	StartTime     int64                         `json:"start-time"`
	CalcTime      int64                         `json:"calc-time"`
	CalcTimeUnit  CalcDirtyRateArgsCalcTimeUnit `json:"calc-time-unit"`
	SamplePages   int64                         `json:"sample-pages"`
	Mode          CalcDirtyRateArgsMode         `json:"mode"`
	VcpuDirtyRate []TypeN456                    `json:"vcpu-dirty-rate,omitempty"`
}

// QueryDisplayOptionsResult is QAPI object 146.
type QueryDisplayOptionsResult struct {
	Type_           QueryDisplayOptionsResultType_       `json:"type"`
	FullScreen      *bool                                `json:"full-screen,omitempty"`
	WindowClose     *bool                                `json:"window-close,omitempty"`
	ShowCursor      *bool                                `json:"show-cursor,omitempty"`
	Gl              *QueryDisplayOptionsResultGl         `json:"gl,omitempty"`
	Clipboard       *bool                                `json:"clipboard,omitempty"`
	GrabOnHover     *bool                                `json:"grab-on-hover,omitempty"`
	ZoomToFit       *bool                                `json:"zoom-to-fit,omitempty"`
	ShowTabs        *bool                                `json:"show-tabs,omitempty"`
	ShowMenubar     *bool                                `json:"show-menubar,omitempty"`
	KeepAspectRatio *bool                                `json:"keep-aspect-ratio,omitempty"`
	Scale           *float64                             `json:"scale,omitempty"`
	Charset         *string                              `json:"charset,omitempty"`
	Rendernode      *string                              `json:"rendernode,omitempty"`
	Addr            *string                              `json:"addr,omitempty"`
	P2p             *bool                                `json:"p2p,omitempty"`
	Audiodev        *string                              `json:"audiodev,omitempty"`
	GrabMod         *QueryDisplayOptionsResultSdlGrabMod `json:"grab-mod,omitempty"`
}

// QueryDisplayOptionsResultCurses is QAPI object 433.
type QueryDisplayOptionsResultCurses struct {
	Charset *string `json:"charset,omitempty"`
}

// QueryDisplayOptionsResultDbus is QAPI object 435.
type QueryDisplayOptionsResultDbus struct {
	Rendernode *string `json:"rendernode,omitempty"`
	Addr       *string `json:"addr,omitempty"`
	P2p        *bool   `json:"p2p,omitempty"`
	Audiodev   *string `json:"audiodev,omitempty"`
}

// QueryDisplayOptionsResultEglHeadless is QAPI object 434.
type QueryDisplayOptionsResultEglHeadless struct {
	Rendernode *string `json:"rendernode,omitempty"`
}

// QueryDisplayOptionsResultGtk is QAPI object 431.
type QueryDisplayOptionsResultGtk struct {
	Clipboard       *bool    `json:"clipboard,omitempty"`
	GrabOnHover     *bool    `json:"grab-on-hover,omitempty"`
	ZoomToFit       *bool    `json:"zoom-to-fit,omitempty"`
	ShowTabs        *bool    `json:"show-tabs,omitempty"`
	ShowMenubar     *bool    `json:"show-menubar,omitempty"`
	KeepAspectRatio *bool    `json:"keep-aspect-ratio,omitempty"`
	Scale           *float64 `json:"scale,omitempty"`
}

// QueryDisplayOptionsResultSdl is QAPI object 436.
type QueryDisplayOptionsResultSdl struct {
	GrabMod *QueryDisplayOptionsResultSdlGrabMod `json:"grab-mod,omitempty"`
}

// QueryDumpGuestMemoryCapabilityResult is QAPI object 104.
type QueryDumpGuestMemoryCapabilityResult struct {
	Formats []DumpGuestMemoryArgsFormat `json:"formats"`
}

// QueryDumpResult is QAPI object 102.
type QueryDumpResult struct {
	Status    QueryDumpResultStatus `json:"status"`
	Completed int64                 `json:"completed"`
	Total     int64                 `json:"total"`
}

// QueryFirmwareLogArgs is QAPI object 222.
type QueryFirmwareLogArgs struct {
	MaxSize *int64 `json:"max-size,omitempty"`
}

// QueryFirmwareLogResult is QAPI object 223.
type QueryFirmwareLogResult struct {
	Version *string `json:"version,omitempty"`
	Log     string  `json:"log"`
}

// QueryHvBalloonStatusReportResult is QAPI object 217.
type QueryHvBalloonStatusReportResult struct {
	Committed int64 `json:"committed"`
	Available int64 `json:"available"`
}

// QueryKvmResult is QAPI object 18.
type QueryKvmResult struct {
	Enabled bool `json:"enabled"`
	Present bool `json:"present"`
}

// QueryMachinesArgs is QAPI object 203.
type QueryMachinesArgs struct {
	CompatProps *bool `json:"compat-props,omitempty"`
}

// QueryMemorySizeSummaryResult is QAPI object 218.
type QueryMemorySizeSummaryResult struct {
	BaseMemory    int64  `json:"base-memory"`
	PluggedMemory *int64 `json:"plugged-memory,omitempty"`
}

// QueryMigrateResult is QAPI object 150.
type QueryMigrateResult struct {
	Status                         *QueryMigrateResultStatus        `json:"status,omitempty"`
	Ram                            *QueryMigrateResultRam           `json:"ram,omitempty"`
	Remaining                      *int64                           `json:"remaining,omitempty"`
	Vfio                           *QueryMigrateResultVfio          `json:"vfio,omitempty"`
	XbzrleCache                    *QueryMigrateResultXbzrleCache   `json:"xbzrle-cache,omitempty"`
	TotalTime                      *int64                           `json:"total-time,omitempty"`
	ExpectedDowntime               *int64                           `json:"expected-downtime,omitempty"`
	Downtime                       *int64                           `json:"downtime,omitempty"`
	SetupTime                      *int64                           `json:"setup-time,omitempty"`
	CpuThrottlePercentage          *int64                           `json:"cpu-throttle-percentage,omitempty"`
	ErrorDesc                      *string                          `json:"error-desc,omitempty"`
	BlockedReasons                 []string                         `json:"blocked-reasons,omitempty"`
	PostcopyBlocktime              *int64                           `json:"postcopy-blocktime,omitempty"`
	PostcopyVcpuBlocktime          []int64                          `json:"postcopy-vcpu-blocktime,omitempty"`
	PostcopyLatency                *int64                           `json:"postcopy-latency,omitempty"`
	PostcopyLatencyDist            []int64                          `json:"postcopy-latency-dist,omitempty"`
	PostcopyVcpuLatency            []int64                          `json:"postcopy-vcpu-latency,omitempty"`
	PostcopyNonVcpuLatency         *int64                           `json:"postcopy-non-vcpu-latency,omitempty"`
	SocketAddress                  []NETDEVSTREAMCONNECTEDEventAddr `json:"socket-address,omitempty"`
	DirtyLimitThrottleTimePerRound *int64                           `json:"dirty-limit-throttle-time-per-round,omitempty"`
	DirtyLimitRingFullTime         *int64                           `json:"dirty-limit-ring-full-time,omitempty"`
}

// QueryMigrateResultRam is QAPI object 442.
type QueryMigrateResultRam struct {
	Transferred             int64   `json:"transferred"`
	Remaining               int64   `json:"remaining"`
	Total                   int64   `json:"total"`
	Duplicate               int64   `json:"duplicate"`
	Normal                  int64   `json:"normal"`
	NormalBytes             int64   `json:"normal-bytes"`
	DirtyPagesRate          int64   `json:"dirty-pages-rate"`
	Mbps                    float64 `json:"mbps"`
	DirtySyncCount          int64   `json:"dirty-sync-count"`
	PostcopyRequests        int64   `json:"postcopy-requests"`
	PageSize                int64   `json:"page-size"`
	MultifdBytes            int64   `json:"multifd-bytes"`
	PagesPerSecond          int64   `json:"pages-per-second"`
	PrecopyBytes            int64   `json:"precopy-bytes"`
	DowntimeBytes           int64   `json:"downtime-bytes"`
	PostcopyBytes           int64   `json:"postcopy-bytes"`
	DirtySyncMissedZeroCopy int64   `json:"dirty-sync-missed-zero-copy"`
}

// QueryMigrateResultVfio is QAPI object 443.
type QueryMigrateResultVfio struct {
	Transferred int64 `json:"transferred"`
}

// QueryMigrateResultXbzrleCache is QAPI object 444.
type QueryMigrateResultXbzrleCache struct {
	CacheSize     int64   `json:"cache-size"`
	Bytes         int64   `json:"bytes"`
	Pages         int64   `json:"pages"`
	CacheMiss     int64   `json:"cache-miss"`
	CacheMissRate float64 `json:"cache-miss-rate"`
	EncodingRate  float64 `json:"encoding-rate"`
	Overflow      int64   `json:"overflow"`
}

// QueryNameResult is QAPI object 241.
type QueryNameResult struct {
	Name *string `json:"name,omitempty"`
}

// QueryNamedBlockNodesArgs is QAPI object 44.
type QueryNamedBlockNodesArgs struct {
	Flat *bool `json:"flat,omitempty"`
}

// QueryReplayResult is QAPI object 235.
type QueryReplayResult struct {
	Mode     QueryReplayResultMode `json:"mode"`
	Filename *string               `json:"filename,omitempty"`
	Icount   int64                 `json:"icount"`
}

// QueryRockerArgs is QAPI object 119.
type QueryRockerArgs struct {
	Name string `json:"name"`
}

// QueryRockerOfDpaFlowsArgs is QAPI object 123.
type QueryRockerOfDpaFlowsArgs struct {
	Name  string `json:"name"`
	TblId *int64 `json:"tbl-id,omitempty"`
}

// QueryRockerOfDpaGroupsArgs is QAPI object 125.
type QueryRockerOfDpaGroupsArgs struct {
	Name  string `json:"name"`
	Type_ *int64 `json:"type,omitempty"`
}

// QueryRockerPortsArgs is QAPI object 121.
type QueryRockerPortsArgs struct {
	Name string `json:"name"`
}

// QueryRockerResult is QAPI object 120.
type QueryRockerResult struct {
	Name  string `json:"name"`
	Id    int64  `json:"id"`
	Ports int64  `json:"ports"`
}

// QueryRxFilterArgs is QAPI object 108.
type QueryRxFilterArgs struct {
	Name *string `json:"name,omitempty"`
}

// QueryS390xCpuPolarizationResult is QAPI object 234.
type QueryS390xCpuPolarizationResult struct {
	Polarization CPUPOLARIZATIONCHANGEEventPolarization `json:"polarization"`
}

// QuerySevAttestationReportArgs is QAPI object 260.
type QuerySevAttestationReportArgs struct {
	Mnonce string `json:"mnonce"`
}

// QuerySevAttestationReportResult is QAPI object 261.
type QuerySevAttestationReportResult struct {
	Data string `json:"data"`
}

// QuerySevCapabilitiesResult is QAPI object 258.
type QuerySevCapabilitiesResult struct {
	Pdh             string `json:"pdh"`
	CertChain       string `json:"cert-chain"`
	Cpu0Id          string `json:"cpu0-id"`
	Cbitpos         int64  `json:"cbitpos"`
	ReducedPhysBits int64  `json:"reduced-phys-bits"`
}

// QuerySevLaunchMeasureResult is QAPI object 257.
type QuerySevLaunchMeasureResult struct {
	Data string `json:"data"`
}

// QuerySevResult is QAPI object 256.
type QuerySevResult struct {
	Enabled   bool                  `json:"enabled"`
	ApiMajor  int64                 `json:"api-major"`
	ApiMinor  int64                 `json:"api-minor"`
	BuildId   int64                 `json:"build-id"`
	State     QuerySevResultState   `json:"state"`
	SevType   QuerySevResultSevType `json:"sev-type"`
	Policy    *int64                `json:"policy,omitempty"`
	Handle    *int64                `json:"handle,omitempty"`
	SnpPolicy *int64                `json:"snp-policy,omitempty"`
}

// QuerySevResultSev is QAPI object 551.
type QuerySevResultSev struct {
	Policy int64 `json:"policy"`
	Handle int64 `json:"handle"`
}

// QuerySevResultSevSnp is QAPI object 552.
type QuerySevResultSevSnp struct {
	SnpPolicy int64 `json:"snp-policy"`
}

// QuerySgxResult is QAPI object 262.
type QuerySgxResult struct {
	Sgx      bool       `json:"sgx"`
	Sgx1     bool       `json:"sgx1"`
	Sgx2     bool       `json:"sgx2"`
	Flc      bool       `json:"flc"`
	Sections []TypeN553 `json:"sections"`
}

// QuerySpiceResult is QAPI object 133.
type QuerySpiceResult struct {
	Enabled         bool                          `json:"enabled"`
	Migrated        bool                          `json:"migrated"`
	Host            *string                       `json:"host,omitempty"`
	Port            *int64                        `json:"port,omitempty"`
	TlsPort         *int64                        `json:"tls-port,omitempty"`
	Auth            *string                       `json:"auth,omitempty"`
	CompiledVersion *string                       `json:"compiled-version,omitempty"`
	MouseMode       QuerySpiceResultMouseMode     `json:"mouse-mode"`
	Channels        []SPICEINITIALIZEDEventClient `json:"channels,omitempty"`
}

// QueryStatsArgs is QAPI object 270.
type QueryStatsArgs struct {
	Target    QueryStatsArgsTarget `json:"target"`
	Providers []TypeN571           `json:"providers,omitempty"`
	Vcpus     []string             `json:"vcpus,omitempty"`
}

// QueryStatsArgsVcpu is QAPI object 572.
type QueryStatsArgsVcpu struct {
	Vcpus []string `json:"vcpus,omitempty"`
}

// QueryStatsSchemasArgs is QAPI object 272.
type QueryStatsSchemasArgs struct {
	Provider *QueryStatsSchemasArgsProvider `json:"provider,omitempty"`
}

// QueryStatusResult is QAPI object 1.
type QueryStatusResult struct {
	Running bool                    `json:"running"`
	Status  QueryStatusResultStatus `json:"status"`
}

// QueryTargetResult is QAPI object 206.
type QueryTargetResult struct {
	Arch QueryTargetResultArch `json:"arch"`
}

// QueryUuidResult is QAPI object 207.
type QueryUuidResult struct {
	UUID string `json:"UUID"`
}

// QueryVmGenerationIdResult is QAPI object 208.
type QueryVmGenerationIdResult struct {
	Guid string `json:"guid"`
}

// QueryVncResult is QAPI object 137.
type QueryVncResult struct {
	Enabled bool                        `json:"enabled"`
	Host    *string                     `json:"host,omitempty"`
	Family  *QueryVncResultFamily       `json:"family,omitempty"`
	Service *string                     `json:"service,omitempty"`
	Auth    *string                     `json:"auth,omitempty"`
	Clients []VNCINITIALIZEDEventClient `json:"clients,omitempty"`
}

// QueryXenReplicationStatusResult is QAPI object 164.
type QueryXenReplicationStatusResult struct {
	Error bool    `json:"error"`
	Desc  *string `json:"desc,omitempty"`
}

// RESETEvent is QAPI object 3.
type RESETEvent struct {
	Guest  bool                `json:"guest"`
	Reason SHUTDOWNEventReason `json:"reason"`
}

// RTCCHANGEEvent is QAPI object 253.
type RTCCHANGEEvent struct {
	Offset  int64  `json:"offset"`
	QomPath string `json:"qom-path"`
}

// RemoveFdArgs is QAPI object 249.
type RemoveFdArgs struct {
	FdsetId int64  `json:"fdset-id"`
	Fd      *int64 `json:"fd,omitempty"`
}

// ReplayBreakArgs is QAPI object 236.
type ReplayBreakArgs struct {
	Icount int64 `json:"icount"`
}

// ReplaySeekArgs is QAPI object 237.
type ReplaySeekArgs struct {
	Icount int64 `json:"icount"`
}

// RequestEbpfArgs is QAPI object 117.
type RequestEbpfArgs struct {
	Id RequestEbpfArgsId `json:"id"`
}

// RequestEbpfResult is QAPI object 118.
type RequestEbpfResult struct {
	Object string `json:"object"`
}

// RingbufReadArgs is QAPI object 94.
type RingbufReadArgs struct {
	Device string                  `json:"device"`
	Size   int64                   `json:"size"`
	Format *RingbufWriteArgsFormat `json:"format,omitempty"`
}

// RingbufWriteArgs is QAPI object 93.
type RingbufWriteArgs struct {
	Device string                  `json:"device"`
	Data   string                  `json:"data"`
	Format *RingbufWriteArgsFormat `json:"format,omitempty"`
}

// SHUTDOWNEvent is QAPI object 2.
type SHUTDOWNEvent struct {
	Guest  bool                `json:"guest"`
	Reason SHUTDOWNEventReason `json:"reason"`
}

// SPICECONNECTEDEvent is QAPI object 134.
type SPICECONNECTEDEvent struct {
	Server SPICECONNECTEDEventServer `json:"server"`
	Client SPICECONNECTEDEventServer `json:"client"`
}

// SPICECONNECTEDEventServer is QAPI object 418.
type SPICECONNECTEDEventServer struct {
	Host   string               `json:"host"`
	Port   string               `json:"port"`
	Family QueryVncResultFamily `json:"family"`
}

// SPICEDISCONNECTEDEvent is QAPI object 136.
type SPICEDISCONNECTEDEvent struct {
	Server SPICECONNECTEDEventServer `json:"server"`
	Client SPICECONNECTEDEventServer `json:"client"`
}

// SPICEINITIALIZEDEvent is QAPI object 135.
type SPICEINITIALIZEDEvent struct {
	Server SPICEINITIALIZEDEventServer `json:"server"`
	Client SPICEINITIALIZEDEventClient `json:"client"`
}

// SPICEINITIALIZEDEventClient is QAPI object 417.
type SPICEINITIALIZEDEventClient struct {
	Host         string               `json:"host"`
	Port         string               `json:"port"`
	Family       QueryVncResultFamily `json:"family"`
	ConnectionId int64                `json:"connection-id"`
	ChannelType  int64                `json:"channel-type"`
	ChannelId    int64                `json:"channel-id"`
	Tls          bool                 `json:"tls"`
}

// SPICEINITIALIZEDEventServer is QAPI object 419.
type SPICEINITIALIZEDEventServer struct {
	Host   string               `json:"host"`
	Port   string               `json:"port"`
	Family QueryVncResultFamily `json:"family"`
	Auth   *string              `json:"auth,omitempty"`
}

// ScreendumpArgs is QAPI object 132.
type ScreendumpArgs struct {
	Filename string       `json:"filename"`
	Device   *string      `json:"device,omitempty"`
	Head     *int64       `json:"head,omitempty"`
	Format   *ImageFormat `json:"format,omitempty"`
}

// SendKeyArgs is QAPI object 144.
type SendKeyArgs struct {
	Keys     []KeyValue `json:"keys"`
	HoldTime *int64     `json:"hold-time,omitempty"`
}

// SetActionArgs is QAPI object 6.
type SetActionArgs struct {
	Reboot   *SetActionArgsReboot   `json:"reboot,omitempty"`
	Shutdown *SetActionArgsShutdown `json:"shutdown,omitempty"`
	Panic    *SetActionArgsPanic    `json:"panic,omitempty"`
	Watchdog *WATCHDOGEventAction   `json:"watchdog,omitempty"`
}

// SetCpuTopologyArgs is QAPI object 232.
type SetCpuTopologyArgs struct {
	CoreId      int64                          `json:"core-id"`
	SocketId    *int64                         `json:"socket-id,omitempty"`
	BookId      *int64                         `json:"book-id,omitempty"`
	DrawerId    *int64                         `json:"drawer-id,omitempty"`
	Entitlement *SetCpuTopologyArgsEntitlement `json:"entitlement,omitempty"`
	Dedicated   *bool                          `json:"dedicated,omitempty"`
}

// SetLinkArgs is QAPI object 105.
type SetLinkArgs struct {
	Name string `json:"name"`
	Up   bool   `json:"up"`
}

// SetNumaNodeArgs is QAPI object 213.
type SetNumaNodeArgs struct {
	Type_         SetNumaNodeArgsType_                   `json:"type"`
	Nodeid        *int64                                 `json:"nodeid,omitempty"`
	Cpus          []int64                                `json:"cpus,omitempty"`
	Mem           *int64                                 `json:"mem,omitempty"`
	Memdev        *string                                `json:"memdev,omitempty"`
	Initiator     *int64                                 `json:"initiator,omitempty"`
	Src           *int64                                 `json:"src,omitempty"`
	Dst           *int64                                 `json:"dst,omitempty"`
	Val           *int64                                 `json:"val,omitempty"`
	NodeId        *int64                                 `json:"node-id,omitempty"`
	DrawerId      *int64                                 `json:"drawer-id,omitempty"`
	BookId        *int64                                 `json:"book-id,omitempty"`
	SocketId      *int64                                 `json:"socket-id,omitempty"`
	DieId         *int64                                 `json:"die-id,omitempty"`
	ClusterId     *int64                                 `json:"cluster-id,omitempty"`
	ModuleId      *int64                                 `json:"module-id,omitempty"`
	CoreId        *int64                                 `json:"core-id,omitempty"`
	ThreadId      *int64                                 `json:"thread-id,omitempty"`
	Target        *int64                                 `json:"target,omitempty"`
	Hierarchy     *SetNumaNodeArgsHmatLbHierarchy        `json:"hierarchy,omitempty"`
	DataType      *SetNumaNodeArgsHmatLbDataType         `json:"data-type,omitempty"`
	Latency       *int64                                 `json:"latency,omitempty"`
	Bandwidth     *int64                                 `json:"bandwidth,omitempty"`
	Size          *int64                                 `json:"size,omitempty"`
	Level         *int64                                 `json:"level,omitempty"`
	Associativity *SetNumaNodeArgsHmatCacheAssociativity `json:"associativity,omitempty"`
	Policy        *SetNumaNodeArgsHmatCachePolicy        `json:"policy,omitempty"`
	Line          *int64                                 `json:"line,omitempty"`
}

// SetNumaNodeArgsCpu is QAPI object 528.
type SetNumaNodeArgsCpu struct {
	NodeId    *int64 `json:"node-id,omitempty"`
	DrawerId  *int64 `json:"drawer-id,omitempty"`
	BookId    *int64 `json:"book-id,omitempty"`
	SocketId  *int64 `json:"socket-id,omitempty"`
	DieId     *int64 `json:"die-id,omitempty"`
	ClusterId *int64 `json:"cluster-id,omitempty"`
	ModuleId  *int64 `json:"module-id,omitempty"`
	CoreId    *int64 `json:"core-id,omitempty"`
	ThreadId  *int64 `json:"thread-id,omitempty"`
}

// SetNumaNodeArgsDist is QAPI object 527.
type SetNumaNodeArgsDist struct {
	Src int64 `json:"src"`
	Dst int64 `json:"dst"`
	Val int64 `json:"val"`
}

// SetNumaNodeArgsHmatCache is QAPI object 530.
type SetNumaNodeArgsHmatCache struct {
	NodeId        int64                                 `json:"node-id"`
	Size          int64                                 `json:"size"`
	Level         int64                                 `json:"level"`
	Associativity SetNumaNodeArgsHmatCacheAssociativity `json:"associativity"`
	Policy        SetNumaNodeArgsHmatCachePolicy        `json:"policy"`
	Line          int64                                 `json:"line"`
}

// SetNumaNodeArgsHmatLb is QAPI object 529.
type SetNumaNodeArgsHmatLb struct {
	Initiator int64                          `json:"initiator"`
	Target    int64                          `json:"target"`
	Hierarchy SetNumaNodeArgsHmatLbHierarchy `json:"hierarchy"`
	DataType  SetNumaNodeArgsHmatLbDataType  `json:"data-type"`
	Latency   *int64                         `json:"latency,omitempty"`
	Bandwidth *int64                         `json:"bandwidth,omitempty"`
}

// SetNumaNodeArgsNode is QAPI object 526.
type SetNumaNodeArgsNode struct {
	Nodeid    *int64  `json:"nodeid,omitempty"`
	Cpus      []int64 `json:"cpus,omitempty"`
	Mem       *int64  `json:"mem,omitempty"`
	Memdev    *string `json:"memdev,omitempty"`
	Initiator *int64  `json:"initiator,omitempty"`
}

// SetPasswordArgs is QAPI object 130.
type SetPasswordArgs struct {
	Protocol  SetPasswordArgsProtocol   `json:"protocol"`
	Password  string                    `json:"password"`
	Connected *SetPasswordArgsConnected `json:"connected,omitempty"`
	Display   *string                   `json:"display,omitempty"`
}

// SetPasswordArgsVnc is QAPI object 413.
type SetPasswordArgsVnc struct {
	Display *string `json:"display,omitempty"`
}

// SetVcpuDirtyLimitArgs is QAPI object 171.
type SetVcpuDirtyLimitArgs struct {
	CpuIndex  *int64 `json:"cpu-index,omitempty"`
	DirtyRate int64  `json:"dirty-rate"`
}

// SevInjectLaunchSecretArgs is QAPI object 259.
type SevInjectLaunchSecretArgs struct {
	PacketHeader string `json:"packet-header"`
	Secret       string `json:"secret"`
	Gpa          *int64 `json:"gpa,omitempty"`
}

// SnapshotDeleteArgs is QAPI object 176.
type SnapshotDeleteArgs struct {
	JobId   string   `json:"job-id"`
	Tag     string   `json:"tag"`
	Devices []string `json:"devices"`
}

// SnapshotLoadArgs is QAPI object 175.
type SnapshotLoadArgs struct {
	JobId   string   `json:"job-id"`
	Tag     string   `json:"tag"`
	Vmstate string   `json:"vmstate"`
	Devices []string `json:"devices"`
}

// SnapshotSaveArgs is QAPI object 174.
type SnapshotSaveArgs struct {
	JobId   string   `json:"job-id"`
	Tag     string   `json:"tag"`
	Vmstate string   `json:"vmstate"`
	Devices []string `json:"devices"`
}

// TraceEventGetStateArgs is QAPI object 178.
type TraceEventGetStateArgs struct {
	Name string `json:"name"`
}

// TraceEventSetStateArgs is QAPI object 180.
type TraceEventSetStateArgs struct {
	Name              string `json:"name"`
	Enable            bool   `json:"enable"`
	IgnoreUnavailable *bool  `json:"ignore-unavailable,omitempty"`
}

// TransactionArgs is QAPI object 177.
type TransactionArgs struct {
	Actions    []TypeN457                 `json:"actions"`
	Properties *TransactionArgsProperties `json:"properties,omitempty"`
}

// TransactionArgsProperties is QAPI object 458.
type TransactionArgsProperties struct {
	CompletionMode *TransactionArgsPropertiesCompletionMode `json:"completion-mode,omitempty"`
}

// TypeN109 is QAPI object 109.
type TypeN109 struct {
	Name              string   `json:"name"`
	Promiscuous       bool     `json:"promiscuous"`
	Multicast         TypeN402 `json:"multicast"`
	Unicast           TypeN402 `json:"unicast"`
	Vlan              TypeN402 `json:"vlan"`
	BroadcastAllowed  bool     `json:"broadcast-allowed"`
	MulticastOverflow bool     `json:"multicast-overflow"`
	UnicastOverflow   bool     `json:"unicast-overflow"`
	MainMac           string   `json:"main-mac"`
	VlanTable         []int64  `json:"vlan-table"`
	UnicastTable      []string `json:"unicast-table"`
	MulticastTable    []string `json:"multicast-table"`
}

// TypeN122 is QAPI object 122.
type TypeN122 struct {
	Name    string   `json:"name"`
	Enabled bool     `json:"enabled"`
	LinkUp  bool     `json:"link-up"`
	Speed   int64    `json:"speed"`
	Duplex  TypeN405 `json:"duplex"`
	Autoneg TypeN406 `json:"autoneg"`
}

// TypeN124 is QAPI object 124.
type TypeN124 struct {
	Cookie int64    `json:"cookie"`
	Hits   int64    `json:"hits"`
	Key    TypeN407 `json:"key"`
	Mask   TypeN408 `json:"mask"`
	Action TypeN409 `json:"action"`
}

// TypeN126 is QAPI object 126.
type TypeN126 struct {
	Id        int64   `json:"id"`
	Type_     int64   `json:"type"`
	VlanId    *int64  `json:"vlan-id,omitempty"`
	Pport     *int64  `json:"pport,omitempty"`
	Index     *int64  `json:"index,omitempty"`
	OutPport  *int64  `json:"out-pport,omitempty"`
	GroupId   *int64  `json:"group-id,omitempty"`
	SetVlanId *int64  `json:"set-vlan-id,omitempty"`
	PopVlan   *int64  `json:"pop-vlan,omitempty"`
	GroupIds  []int64 `json:"group-ids,omitempty"`
	SetEthSrc *string `json:"set-eth-src,omitempty"`
	SetEthDst *string `json:"set-eth-dst,omitempty"`
	TtlCheck  *int64  `json:"ttl-check,omitempty"`
}

// TypeN129 is QAPI object 129.
type TypeN129 struct {
	Id      string   `json:"id"`
	Model   TypeN127 `json:"model"`
	Options TypeN410 `json:"options"`
}

// TypeN138 is QAPI object 138.
type TypeN138 struct {
	Id       string                      `json:"id"`
	Server   []TypeN422                  `json:"server"`
	Clients  []VNCINITIALIZEDEventClient `json:"clients"`
	Auth     TypeN423                    `json:"auth"`
	Vencrypt *TypeN424                   `json:"vencrypt,omitempty"`
	Display  *string                     `json:"display,omitempty"`
}

// TypeN143 is QAPI object 143.
type TypeN143 struct {
	Name     string `json:"name"`
	Index    int64  `json:"index"`
	Current  bool   `json:"current"`
	Absolute bool   `json:"absolute"`
}

// TypeN152 is QAPI object 152.
type TypeN152 struct {
	Capability TypeN445 `json:"capability"`
	State      bool     `json:"state"`
}

// TypeN17 is QAPI object 17.
type TypeN17 struct {
	Id              string                     `json:"id"`
	Type_           BlockJobChangeArgsType_    `json:"type"`
	Status          JOBSTATUSCHANGEEventStatus `json:"status"`
	CurrentProgress int64                      `json:"current-progress"`
	TotalProgress   int64                      `json:"total-progress"`
	Error           *string                    `json:"error,omitempty"`
}

// TypeN173 is QAPI object 173.
type TypeN173 struct {
	CpuIndex    int64 `json:"cpu-index"`
	LimitRate   int64 `json:"limit-rate"`
	CurrentRate int64 `json:"current-rate"`
}

// TypeN179 is QAPI object 179.
type TypeN179 struct {
	Name  string   `json:"name"`
	State TypeN459 `json:"state"`
}

// TypeN183 is QAPI object 183.
type TypeN183 struct {
	Name string `json:"name"`
}

// TypeN184 is QAPI object 184.
type TypeN184 struct {
	Name        string     `json:"name"`
	MetaType    TypeN462   `json:"meta-type"`
	Features    []string   `json:"features,omitempty"`
	JsonType    *TypeN695  `json:"json-type,omitempty"`
	Members     any        `json:"members,omitempty"`
	Values      []string   `json:"values,omitempty"`
	ElementType *string    `json:"element-type,omitempty"`
	Tag         *string    `json:"tag,omitempty"`
	Variants    []TypeN698 `json:"variants,omitempty"`
	ArgType     *string    `json:"arg-type,omitempty"`
	RetType     *string    `json:"ret-type,omitempty"`
	AllowOob    *bool      `json:"allow-oob,omitempty"`
}

// TypeN186 is QAPI object 186.
type TypeN186 struct {
	Name         string  `json:"name"`
	Type_        string  `json:"type"`
	Description  *string `json:"description,omitempty"`
	DefaultValue any     `json:"default-value,omitempty"`
}

// TypeN189 is QAPI object 189.
type TypeN189 struct {
	Properties []TypeN470 `json:"properties"`
}

// TypeN192 is QAPI object 192.
type TypeN192 struct {
	Name     string  `json:"name"`
	Abstract *bool   `json:"abstract,omitempty"`
	Parent   *string `json:"parent,omitempty"`
}

// TypeN202 is QAPI object 202.
type TypeN202 struct {
	CpuIndex    int64                          `json:"cpu-index"`
	QomType     string                         `json:"qom-type"`
	QomPath     string                         `json:"qom-path"`
	ThreadId    int64                          `json:"thread-id"`
	Props       *TypeN520                      `json:"props,omitempty"`
	Target      QueryTargetResultArch          `json:"target"`
	CpuState    *TypeN709                      `json:"cpu-state,omitempty"`
	Dedicated   *bool                          `json:"dedicated,omitempty"`
	Entitlement *SetCpuTopologyArgsEntitlement `json:"entitlement,omitempty"`
}

// TypeN204 is QAPI object 204.
type TypeN204 struct {
	Name             string     `json:"name"`
	Alias            *string    `json:"alias,omitempty"`
	IsDefault        *bool      `json:"is-default,omitempty"`
	CpuMax           int64      `json:"cpu-max"`
	HotpluggableCpus bool       `json:"hotpluggable-cpus"`
	NumaMemSupported bool       `json:"numa-mem-supported"`
	Deprecated       bool       `json:"deprecated"`
	DefaultCpuType   *string    `json:"default-cpu-type,omitempty"`
	DefaultRamId     *string    `json:"default-ram-id,omitempty"`
	Acpi             bool       `json:"acpi"`
	CompatProps      []TypeN523 `json:"compat-props,omitempty"`
}

// TypeN21 is QAPI object 21.
type TypeN21 struct {
	Id        string `json:"id"`
	Connected bool   `json:"connected"`
}

// TypeN211 is QAPI object 211.
type TypeN211 struct {
	Id        *string                             `json:"id,omitempty"`
	Size      int64                               `json:"size"`
	Merge     bool                                `json:"merge"`
	Dump      bool                                `json:"dump"`
	Prealloc  bool                                `json:"prealloc"`
	Share     bool                                `json:"share"`
	Reserve   *bool                               `json:"reserve,omitempty"`
	HostNodes []int64                             `json:"host-nodes"`
	Policy    ObjectAddArgsMemoryBackendEpcPolicy `json:"policy"`
}

// TypeN212 is QAPI object 212.
type TypeN212 struct {
	Type_      string   `json:"type"`
	VcpusCount int64    `json:"vcpus-count"`
	Props      TypeN520 `json:"props"`
	QomPath    *string  `json:"qom-path,omitempty"`
}

// TypeN219 is QAPI object 219.
type TypeN219 struct {
	Type_ TypeN531 `json:"type"`
	Data  any      `json:"data,omitempty"`
}

// TypeN231 is QAPI object 231.
type TypeN231 struct {
	Name                string   `json:"name"`
	MigrationSafe       *bool    `json:"migration-safe,omitempty"`
	Static              bool     `json:"static"`
	UnavailableFeatures []string `json:"unavailable-features,omitempty"`
	Typename            string   `json:"typename"`
	AliasOf             *string  `json:"alias-of,omitempty"`
	Deprecated          bool     `json:"deprecated"`
}

// TypeN239 is QAPI object 239.
type TypeN239 struct {
	Type_    TypeN544 `json:"type"`
	NodeName *string  `json:"node-name,omitempty"`
	Id       *string  `json:"id,omitempty"`
}

// TypeN242 is QAPI object 242.
type TypeN242 struct {
	Id          string `json:"id"`
	ThreadId    int64  `json:"thread-id"`
	PollMaxNs   int64  `json:"poll-max-ns"`
	PollGrow    int64  `json:"poll-grow"`
	PollShrink  int64  `json:"poll-shrink"`
	PollWeight  int64  `json:"poll-weight"`
	AioMaxBatch int64  `json:"aio-max-batch"`
}

// TypeN250 is QAPI object 250.
type TypeN250 struct {
	FdsetId int64      `json:"fdset-id"`
	Fds     []TypeN547 `json:"fds"`
}

// TypeN252 is QAPI object 252.
type TypeN252 struct {
	Option     string     `json:"option"`
	Parameters []TypeN548 `json:"parameters"`
}

// TypeN255 is QAPI object 255.
type TypeN255 struct {
	Version  int64 `json:"version"`
	Emulated bool  `json:"emulated"`
	Kernel   bool  `json:"kernel"`
}

// TypeN263 is QAPI object 263.
type TypeN263 struct {
	Port         int64    `json:"port"`
	Vcpu         int64    `json:"vcpu"`
	Type_        TypeN554 `json:"type"`
	RemoteDomain string   `json:"remote-domain"`
	Target       int64    `json:"target"`
	Pending      bool     `json:"pending"`
	Masked       bool     `json:"masked"`
}

// TypeN265 is QAPI object 265.
type TypeN265 struct {
	Id          string   `json:"id"`
	Driver      TypeN555 `json:"driver"`
	TimerPeriod *int64   `json:"timer-period,omitempty"`
	In          any      `json:"in,omitempty"`
	Out         any      `json:"out,omitempty"`
	Threshold   *int64   `json:"threshold,omitempty"`
	Nsamples    *int64   `json:"nsamples,omitempty"`
	TryMmap     *bool    `json:"try-mmap,omitempty"`
	Exclusive   *bool    `json:"exclusive,omitempty"`
	DspPolicy   *int64   `json:"dsp-policy,omitempty"`
	Server      *string  `json:"server,omitempty"`
	Path        *string  `json:"path,omitempty"`
}

// TypeN269 is QAPI object 269.
type TypeN269 struct {
	Bus     int64      `json:"bus"`
	Devices []TypeN569 `json:"devices"`
}

// TypeN271 is QAPI object 271.
type TypeN271 struct {
	Provider QueryStatsSchemasArgsProvider `json:"provider"`
	QomPath  *string                       `json:"qom-path,omitempty"`
	Stats    []TypeN574                    `json:"stats"`
}

// TypeN273 is QAPI object 273.
type TypeN273 struct {
	Provider QueryStatsSchemasArgsProvider `json:"provider"`
	Target   QueryStatsArgsTarget          `json:"target"`
	Stats    []TypeN575                    `json:"stats"`
}

// TypeN274 is QAPI object 274.
type TypeN274 struct {
	Path string `json:"path"`
	Name string `json:"name"`
}

// TypeN284 is QAPI object 284.
type TypeN284 struct {
	Id      string     `json:"id"`
	Service []TypeN583 `json:"service"`
	Client  []TypeN584 `json:"client"`
}

// TypeN309 is QAPI object 309.
type TypeN309 struct {
	RdBytes                     int64      `json:"rd_bytes"`
	WrBytes                     int64      `json:"wr_bytes"`
	ZoneAppendBytes             int64      `json:"zone_append_bytes"`
	UnmapBytes                  int64      `json:"unmap_bytes"`
	RdOperations                int64      `json:"rd_operations"`
	WrOperations                int64      `json:"wr_operations"`
	ZoneAppendOperations        int64      `json:"zone_append_operations"`
	FlushOperations             int64      `json:"flush_operations"`
	UnmapOperations             int64      `json:"unmap_operations"`
	RdTotalTimeNs               int64      `json:"rd_total_time_ns"`
	WrTotalTimeNs               int64      `json:"wr_total_time_ns"`
	ZoneAppendTotalTimeNs       int64      `json:"zone_append_total_time_ns"`
	FlushTotalTimeNs            int64      `json:"flush_total_time_ns"`
	UnmapTotalTimeNs            int64      `json:"unmap_total_time_ns"`
	WrHighestOffset             int64      `json:"wr_highest_offset"`
	RdMerged                    int64      `json:"rd_merged"`
	WrMerged                    int64      `json:"wr_merged"`
	ZoneAppendMerged            int64      `json:"zone_append_merged"`
	UnmapMerged                 int64      `json:"unmap_merged"`
	IdleTimeNs                  *int64     `json:"idle_time_ns,omitempty"`
	FailedRdOperations          int64      `json:"failed_rd_operations"`
	FailedWrOperations          int64      `json:"failed_wr_operations"`
	FailedZoneAppendOperations  int64      `json:"failed_zone_append_operations"`
	FailedFlushOperations       int64      `json:"failed_flush_operations"`
	FailedUnmapOperations       int64      `json:"failed_unmap_operations"`
	InvalidRdOperations         int64      `json:"invalid_rd_operations"`
	InvalidWrOperations         int64      `json:"invalid_wr_operations"`
	InvalidZoneAppendOperations int64      `json:"invalid_zone_append_operations"`
	InvalidFlushOperations      int64      `json:"invalid_flush_operations"`
	InvalidUnmapOperations      int64      `json:"invalid_unmap_operations"`
	AccountInvalid              bool       `json:"account_invalid"`
	AccountFailed               bool       `json:"account_failed"`
	TimedStats                  []TypeN596 `json:"timed_stats"`
	RdLatencyHistogram          *TypeN597  `json:"rd_latency_histogram,omitempty"`
	WrLatencyHistogram          *TypeN597  `json:"wr_latency_histogram,omitempty"`
	ZoneAppendLatencyHistogram  *TypeN597  `json:"zone_append_latency_histogram,omitempty"`
	FlushLatencyHistogram       *TypeN597  `json:"flush_latency_histogram,omitempty"`
}

// TypeN310 is QAPI object 310.
type TypeN310 struct {
	Driver            BlockdevAddArgsDriver `json:"driver"`
	DiscardNbOk       *int64                `json:"discard-nb-ok,omitempty"`
	DiscardNbFailed   *int64                `json:"discard-nb-failed,omitempty"`
	DiscardBytesOk    *int64                `json:"discard-bytes-ok,omitempty"`
	CompletionErrors  *int64                `json:"completion-errors,omitempty"`
	AlignedAccesses   *int64                `json:"aligned-accesses,omitempty"`
	UnalignedAccesses *int64                `json:"unaligned-accesses,omitempty"`
}

// TypeN311 is QAPI object 311.
type TypeN311 struct {
	ActivelySynced bool `json:"actively-synced"`
}

// TypeN318 is QAPI object 318.
type TypeN318 struct {
	Child    string `json:"child"`
	NodeName string `json:"node-name"`
}

// TypeN320 is QAPI object 320.
type TypeN320 struct {
	Filename              string                                     `json:"filename"`
	Format                string                                     `json:"format"`
	DirtyFlag             *bool                                      `json:"dirty-flag,omitempty"`
	ActualSize            *int64                                     `json:"actual-size,omitempty"`
	VirtualSize           int64                                      `json:"virtual-size"`
	ClusterSize           *int64                                     `json:"cluster-size,omitempty"`
	Encrypted             *bool                                      `json:"encrypted,omitempty"`
	Compressed            *bool                                      `json:"compressed,omitempty"`
	BackingFilename       *string                                    `json:"backing-filename,omitempty"`
	FullBackingFilename   *string                                    `json:"full-backing-filename,omitempty"`
	BackingFilenameFormat *string                                    `json:"backing-filename-format,omitempty"`
	Snapshots             []BlockdevSnapshotDeleteInternalSyncResult `json:"snapshots,omitempty"`
	Limits                *TypeN600                                  `json:"limits,omitempty"`
	FormatSpecific        *TypeN601                                  `json:"format-specific,omitempty"`
	BackingImage          *TypeN320                                  `json:"backing-image,omitempty"`
}

// TypeN321 is QAPI object 321.
type TypeN321 struct {
	Writeback bool `json:"writeback"`
	Direct    bool `json:"direct"`
	NoFlush   bool `json:"no-flush"`
}

// TypeN322 is QAPI object 322.
type TypeN322 struct {
	Name         *string `json:"name,omitempty"`
	Count        int64   `json:"count"`
	Granularity  int64   `json:"granularity"`
	Recording    bool    `json:"recording"`
	Busy         bool    `json:"busy"`
	Persistent   bool    `json:"persistent"`
	Inconsistent *bool   `json:"inconsistent,omitempty"`
}

// TypeN323 is QAPI object 323.
type TypeN323 struct {
	Id    int64    `json:"id"`
	Type_ TypeN602 `json:"type"`
	Name  string   `json:"name"`
}

// TypeN324 is QAPI object 324.
type TypeN324 struct {
	Parent     int64      `json:"parent"`
	Child      int64      `json:"child"`
	Name       string     `json:"name"`
	Perm       []TypeN603 `json:"perm"`
	SharedPerm []TypeN603 `json:"shared-perm"`
}

// TypeN33 is QAPI object 33.
type TypeN33 struct {
	Device    string    `json:"device"`
	Qdev      *string   `json:"qdev,omitempty"`
	Type_     string    `json:"type"`
	Removable bool      `json:"removable"`
	Locked    bool      `json:"locked"`
	Inserted  *TypeN45  `json:"inserted,omitempty"`
	TrayOpen  *bool     `json:"tray_open,omitempty"`
	IoStatus  *TypeN308 `json:"io-status,omitempty"`
}

// TypeN35 is QAPI object 35.
type TypeN35 struct {
	Device         *string   `json:"device,omitempty"`
	Qdev           *string   `json:"qdev,omitempty"`
	NodeName       *string   `json:"node-name,omitempty"`
	Stats          TypeN309  `json:"stats"`
	DriverSpecific *TypeN310 `json:"driver-specific,omitempty"`
	Parent         *TypeN35  `json:"parent,omitempty"`
	Backing        *TypeN35  `json:"backing,omitempty"`
}

// TypeN36 is QAPI object 36.
type TypeN36 struct {
	Type_          BlockJobChangeArgsType_    `json:"type"`
	Device         string                     `json:"device"`
	Len            int64                      `json:"len"`
	Offset         int64                      `json:"offset"`
	Busy           bool                       `json:"busy"`
	Paused         bool                       `json:"paused"`
	Speed          int64                      `json:"speed"`
	IoStatus       TypeN308                   `json:"io-status"`
	Ready          bool                       `json:"ready"`
	Status         JOBSTATUSCHANGEEventStatus `json:"status"`
	AutoFinalize   bool                       `json:"auto-finalize"`
	AutoDismiss    bool                       `json:"auto-dismiss"`
	Error          *string                    `json:"error,omitempty"`
	ActivelySynced *bool                      `json:"actively-synced,omitempty"`
}

// TypeN407 is QAPI object 407.
type TypeN407 struct {
	Priority int64   `json:"priority"`
	TblId    int64   `json:"tbl-id"`
	InPport  *int64  `json:"in-pport,omitempty"`
	TunnelId *int64  `json:"tunnel-id,omitempty"`
	VlanId   *int64  `json:"vlan-id,omitempty"`
	EthType  *int64  `json:"eth-type,omitempty"`
	EthSrc   *string `json:"eth-src,omitempty"`
	EthDst   *string `json:"eth-dst,omitempty"`
	IpProto  *int64  `json:"ip-proto,omitempty"`
	IpTos    *int64  `json:"ip-tos,omitempty"`
	IpDst    *string `json:"ip-dst,omitempty"`
}

// TypeN408 is QAPI object 408.
type TypeN408 struct {
	InPport  *int64  `json:"in-pport,omitempty"`
	TunnelId *int64  `json:"tunnel-id,omitempty"`
	VlanId   *int64  `json:"vlan-id,omitempty"`
	EthSrc   *string `json:"eth-src,omitempty"`
	EthDst   *string `json:"eth-dst,omitempty"`
	IpProto  *int64  `json:"ip-proto,omitempty"`
	IpTos    *int64  `json:"ip-tos,omitempty"`
}

// TypeN409 is QAPI object 409.
type TypeN409 struct {
	GotoTbl     *int64 `json:"goto-tbl,omitempty"`
	GroupId     *int64 `json:"group-id,omitempty"`
	TunnelLport *int64 `json:"tunnel-lport,omitempty"`
	VlanId      *int64 `json:"vlan-id,omitempty"`
	NewVlanId   *int64 `json:"new-vlan-id,omitempty"`
	OutPport    *int64 `json:"out-pport,omitempty"`
}

// TypeN410 is QAPI object 410.
type TypeN410 struct {
	Type_ TypeN128 `json:"type"`
	Data  any      `json:"data,omitempty"`
}

// TypeN422 is QAPI object 422.
type TypeN422 struct {
	Host      string               `json:"host"`
	Service   string               `json:"service"`
	Family    QueryVncResultFamily `json:"family"`
	Websocket bool                 `json:"websocket"`
	Auth      TypeN423             `json:"auth"`
	Vencrypt  *TypeN424            `json:"vencrypt,omitempty"`
}

// TypeN428 is QAPI object 428.
type TypeN428 struct {
	Type_ TypeN675 `json:"type"`
	Data  any      `json:"data,omitempty"`
}

// TypeN432 is QAPI object 432.
type TypeN432 struct {
	LeftCommandKey    *bool `json:"left-command-key,omitempty"`
	FullGrab          *bool `json:"full-grab,omitempty"`
	SwapOptCmd        *bool `json:"swap-opt-cmd,omitempty"`
	ZoomToFit         *bool `json:"zoom-to-fit,omitempty"`
	ZoomInterpolation *bool `json:"zoom-interpolation,omitempty"`
}

// TypeN447 is QAPI object 447.
type TypeN447 struct {
	NodeName string     `json:"node-name"`
	Alias    string     `json:"alias"`
	Bitmaps  []TypeN681 `json:"bitmaps"`
}

// TypeN45 is QAPI object 45.
type TypeN45 struct {
	File             string                      `json:"file"`
	NodeName         string                      `json:"node-name"`
	Ro               bool                        `json:"ro"`
	Drv              string                      `json:"drv"`
	BackingFile      *string                     `json:"backing_file,omitempty"`
	BackingFileDepth int64                       `json:"backing_file_depth"`
	Children         []TypeN318                  `json:"children"`
	Active           bool                        `json:"active"`
	Encrypted        bool                        `json:"encrypted"`
	DetectZeroes     BlockdevAddArgsDetectZeroes `json:"detect_zeroes"`
	Bps              int64                       `json:"bps"`
	BpsRd            int64                       `json:"bps_rd"`
	BpsWr            int64                       `json:"bps_wr"`
	Iops             int64                       `json:"iops"`
	IopsRd           int64                       `json:"iops_rd"`
	IopsWr           int64                       `json:"iops_wr"`
	Image            TypeN320                    `json:"image"`
	BpsMax           *int64                      `json:"bps_max,omitempty"`
	BpsRdMax         *int64                      `json:"bps_rd_max,omitempty"`
	BpsWrMax         *int64                      `json:"bps_wr_max,omitempty"`
	IopsMax          *int64                      `json:"iops_max,omitempty"`
	IopsRdMax        *int64                      `json:"iops_rd_max,omitempty"`
	IopsWrMax        *int64                      `json:"iops_wr_max,omitempty"`
	BpsMaxLength     *int64                      `json:"bps_max_length,omitempty"`
	BpsRdMaxLength   *int64                      `json:"bps_rd_max_length,omitempty"`
	BpsWrMaxLength   *int64                      `json:"bps_wr_max_length,omitempty"`
	IopsMaxLength    *int64                      `json:"iops_max_length,omitempty"`
	IopsRdMaxLength  *int64                      `json:"iops_rd_max_length,omitempty"`
	IopsWrMaxLength  *int64                      `json:"iops_wr_max_length,omitempty"`
	IopsSize         *int64                      `json:"iops_size,omitempty"`
	Group            *string                     `json:"group,omitempty"`
	Cache            TypeN321                    `json:"cache"`
	WriteThreshold   int64                       `json:"write_threshold"`
	DirtyBitmaps     []TypeN322                  `json:"dirty-bitmaps,omitempty"`
}

// TypeN452 is QAPI object 452.
type TypeN452 struct {
	ChannelType TypeN682 `json:"channel-type"`
	Addr        TypeN683 `json:"addr"`
}

// TypeN456 is QAPI object 456.
type TypeN456 struct {
	Id        int64 `json:"id"`
	DirtyRate int64 `json:"dirty-rate"`
}

// TypeN457 is QAPI object 457.
type TypeN457 struct {
	Type_ TypeN684 `json:"type"`
	Data  any      `json:"data,omitempty"`
}

// TypeN463 is QAPI object 463.
type TypeN463 struct {
	JsonType TypeN695 `json:"json-type"`
}

// TypeN464 is QAPI object 464.
type TypeN464 struct {
	Members []TypeN696 `json:"members"`
	Values  []string   `json:"values"`
}

// TypeN465 is QAPI object 465.
type TypeN465 struct {
	ElementType string `json:"element-type"`
}

// TypeN466 is QAPI object 466.
type TypeN466 struct {
	Members  []TypeN697 `json:"members"`
	Tag      *string    `json:"tag,omitempty"`
	Variants []TypeN698 `json:"variants,omitempty"`
}

// TypeN467 is QAPI object 467.
type TypeN467 struct {
	Members []TypeN699 `json:"members"`
}

// TypeN468 is QAPI object 468.
type TypeN468 struct {
	ArgType  string `json:"arg-type"`
	RetType  string `json:"ret-type"`
	AllowOob *bool  `json:"allow-oob,omitempty"`
}

// TypeN469 is QAPI object 469.
type TypeN469 struct {
	ArgType string `json:"arg-type"`
}

// TypeN470 is QAPI object 470.
type TypeN470 struct {
	Name  string `json:"name"`
	Type_ string `json:"type"`
	Value any    `json:"value,omitempty"`
}

// TypeN520 is QAPI object 520.
type TypeN520 struct {
	NodeId    *int64 `json:"node-id,omitempty"`
	DrawerId  *int64 `json:"drawer-id,omitempty"`
	BookId    *int64 `json:"book-id,omitempty"`
	SocketId  *int64 `json:"socket-id,omitempty"`
	DieId     *int64 `json:"die-id,omitempty"`
	ClusterId *int64 `json:"cluster-id,omitempty"`
	ModuleId  *int64 `json:"module-id,omitempty"`
	CoreId    *int64 `json:"core-id,omitempty"`
	ThreadId  *int64 `json:"thread-id,omitempty"`
}

// TypeN522 is QAPI object 522.
type TypeN522 struct {
	CpuState    TypeN709                       `json:"cpu-state"`
	Dedicated   *bool                          `json:"dedicated,omitempty"`
	Entitlement *SetCpuTopologyArgsEntitlement `json:"entitlement,omitempty"`
}

// TypeN523 is QAPI object 523.
type TypeN523 struct {
	QomType  string `json:"qom-type"`
	Property string `json:"property"`
	Value    string `json:"value"`
}

// TypeN532 is QAPI object 532.
type TypeN532 struct {
	Data TypeN714 `json:"data"`
}

// TypeN533 is QAPI object 533.
type TypeN533 struct {
	Data TypeN715 `json:"data"`
}

// TypeN534 is QAPI object 534.
type TypeN534 struct {
	Data TypeN716 `json:"data"`
}

// TypeN535 is QAPI object 535.
type TypeN535 struct {
	Data TypeN717 `json:"data"`
}

// TypeN536 is QAPI object 536.
type TypeN536 struct {
	Data TypeN718 `json:"data"`
}

// TypeN537 is QAPI object 537.
type TypeN537 struct {
	Data TypeN719 `json:"data"`
}

// TypeN545 is QAPI object 545.
type TypeN545 struct {
	NodeName string `json:"node-name"`
}

// TypeN546 is QAPI object 546.
type TypeN546 struct {
	Id string `json:"id"`
}

// TypeN547 is QAPI object 547.
type TypeN547 struct {
	Fd     int64   `json:"fd"`
	Opaque *string `json:"opaque,omitempty"`
}

// TypeN548 is QAPI object 548.
type TypeN548 struct {
	Name     string   `json:"name"`
	Type_    TypeN720 `json:"type"`
	Help     *string  `json:"help,omitempty"`
	Default_ *string  `json:"default,omitempty"`
}

// TypeN553 is QAPI object 553.
type TypeN553 struct {
	Node int64 `json:"node"`
	Size int64 `json:"size"`
}

// TypeN556 is QAPI object 556.
type TypeN556 struct {
	In  *TypeN721 `json:"in,omitempty"`
	Out *TypeN721 `json:"out,omitempty"`
}

// TypeN557 is QAPI object 557.
type TypeN557 struct {
	In        *TypeN722 `json:"in,omitempty"`
	Out       *TypeN722 `json:"out,omitempty"`
	Threshold *int64    `json:"threshold,omitempty"`
}

// TypeN558 is QAPI object 558.
type TypeN558 struct {
	In  *TypeN723 `json:"in,omitempty"`
	Out *TypeN723 `json:"out,omitempty"`
}

// TypeN559 is QAPI object 559.
type TypeN559 struct {
	In       *TypeN721 `json:"in,omitempty"`
	Out      *TypeN721 `json:"out,omitempty"`
	Nsamples *int64    `json:"nsamples,omitempty"`
}

// TypeN560 is QAPI object 560.
type TypeN560 struct {
	In      *TypeN721 `json:"in,omitempty"`
	Out     *TypeN721 `json:"out,omitempty"`
	Latency *int64    `json:"latency,omitempty"`
}

// TypeN561 is QAPI object 561.
type TypeN561 struct {
	In  *TypeN724 `json:"in,omitempty"`
	Out *TypeN724 `json:"out,omitempty"`
}

// TypeN562 is QAPI object 562.
type TypeN562 struct {
	In        *TypeN725 `json:"in,omitempty"`
	Out       *TypeN725 `json:"out,omitempty"`
	TryMmap   *bool     `json:"try-mmap,omitempty"`
	Exclusive *bool     `json:"exclusive,omitempty"`
	DspPolicy *int64    `json:"dsp-policy,omitempty"`
}

// TypeN563 is QAPI object 563.
type TypeN563 struct {
	In     *TypeN726 `json:"in,omitempty"`
	Out    *TypeN726 `json:"out,omitempty"`
	Server *string   `json:"server,omitempty"`
}

// TypeN564 is QAPI object 564.
type TypeN564 struct {
	In  *TypeN727 `json:"in,omitempty"`
	Out *TypeN727 `json:"out,omitempty"`
}

// TypeN565 is QAPI object 565.
type TypeN565 struct {
	In  *TypeN728 `json:"in,omitempty"`
	Out *TypeN728 `json:"out,omitempty"`
}

// TypeN566 is QAPI object 566.
type TypeN566 struct {
	In      *TypeN721 `json:"in,omitempty"`
	Out     *TypeN721 `json:"out,omitempty"`
	Dev     *string   `json:"dev,omitempty"`
	Latency *int64    `json:"latency,omitempty"`
}

// TypeN567 is QAPI object 567.
type TypeN567 struct {
	In   *TypeN721 `json:"in,omitempty"`
	Out  *TypeN721 `json:"out,omitempty"`
	Path *string   `json:"path,omitempty"`
}

// TypeN569 is QAPI object 569.
type TypeN569 struct {
	Bus       int64      `json:"bus"`
	Slot      int64      `json:"slot"`
	Function  int64      `json:"function"`
	ClassInfo TypeN729   `json:"class_info"`
	Id        TypeN730   `json:"id"`
	Irq       *int64     `json:"irq,omitempty"`
	IrqPin    int64      `json:"irq_pin"`
	QdevId    string     `json:"qdev_id"`
	PciBridge *TypeN731  `json:"pci_bridge,omitempty"`
	Regions   []TypeN732 `json:"regions"`
}

// TypeN571 is QAPI object 571.
type TypeN571 struct {
	Provider QueryStatsSchemasArgsProvider `json:"provider"`
	Names    []string                      `json:"names,omitempty"`
}

// TypeN574 is QAPI object 574.
type TypeN574 struct {
	Name  string   `json:"name"`
	Value TypeN733 `json:"value"`
}

// TypeN575 is QAPI object 575.
type TypeN575 struct {
	Name       string    `json:"name"`
	Type_      TypeN734  `json:"type"`
	Unit       *TypeN735 `json:"unit,omitempty"`
	Base       *int64    `json:"base,omitempty"`
	Exponent   int64     `json:"exponent"`
	BucketSize *int64    `json:"bucket-size,omitempty"`
}

// TypeN579 is QAPI object 579.
type TypeN579 struct {
	Addr  int64    `json:"addr"`
	Len   int64    `json:"len"`
	Flags []string `json:"flags"`
}

// TypeN584 is QAPI object 584.
type TypeN584 struct {
	Queue int64    `json:"queue"`
	Type_ TypeN737 `json:"type"`
}

// TypeN586 is QAPI object 586.
type TypeN586 struct {
	Type_  TypeN738 `json:"type"`
	Header []int64  `json:"header"`
}

// TypeN589 is QAPI object 589.
type TypeN589 struct {
	Offset int64 `json:"offset"`
	Len    int64 `json:"len"`
}

// TypeN596 is QAPI object 596.
type TypeN596 struct {
	IntervalLength          int64   `json:"interval_length"`
	MinRdLatencyNs          int64   `json:"min_rd_latency_ns"`
	MaxRdLatencyNs          int64   `json:"max_rd_latency_ns"`
	AvgRdLatencyNs          int64   `json:"avg_rd_latency_ns"`
	MinWrLatencyNs          int64   `json:"min_wr_latency_ns"`
	MaxWrLatencyNs          int64   `json:"max_wr_latency_ns"`
	AvgWrLatencyNs          int64   `json:"avg_wr_latency_ns"`
	MinZoneAppendLatencyNs  int64   `json:"min_zone_append_latency_ns"`
	MaxZoneAppendLatencyNs  int64   `json:"max_zone_append_latency_ns"`
	AvgZoneAppendLatencyNs  int64   `json:"avg_zone_append_latency_ns"`
	MinFlushLatencyNs       int64   `json:"min_flush_latency_ns"`
	MaxFlushLatencyNs       int64   `json:"max_flush_latency_ns"`
	AvgFlushLatencyNs       int64   `json:"avg_flush_latency_ns"`
	AvgRdQueueDepth         float64 `json:"avg_rd_queue_depth"`
	AvgWrQueueDepth         float64 `json:"avg_wr_queue_depth"`
	AvgZoneAppendQueueDepth float64 `json:"avg_zone_append_queue_depth"`
}

// TypeN597 is QAPI object 597.
type TypeN597 struct {
	Boundaries []int64 `json:"boundaries"`
	Bins       []int64 `json:"bins"`
}

// TypeN598 is QAPI object 598.
type TypeN598 struct {
	DiscardNbOk     int64 `json:"discard-nb-ok"`
	DiscardNbFailed int64 `json:"discard-nb-failed"`
	DiscardBytesOk  int64 `json:"discard-bytes-ok"`
}

// TypeN599 is QAPI object 599.
type TypeN599 struct {
	CompletionErrors  int64 `json:"completion-errors"`
	AlignedAccesses   int64 `json:"aligned-accesses"`
	UnalignedAccesses int64 `json:"unaligned-accesses"`
}

// TypeN600 is QAPI object 600.
type TypeN600 struct {
	RequestAlignment     int64  `json:"request-alignment"`
	MaxDiscard           *int64 `json:"max-discard,omitempty"`
	DiscardAlignment     *int64 `json:"discard-alignment,omitempty"`
	MaxWriteZeroes       *int64 `json:"max-write-zeroes,omitempty"`
	WriteZeroesAlignment *int64 `json:"write-zeroes-alignment,omitempty"`
	OptTransfer          *int64 `json:"opt-transfer,omitempty"`
	MaxTransfer          *int64 `json:"max-transfer,omitempty"`
	MaxHwTransfer        *int64 `json:"max-hw-transfer,omitempty"`
	MaxIov               int64  `json:"max-iov"`
	MaxHwIov             *int64 `json:"max-hw-iov,omitempty"`
	MinMemAlignment      int64  `json:"min-mem-alignment"`
	OptMemAlignment      int64  `json:"opt-mem-alignment"`
}

// TypeN601 is QAPI object 601.
type TypeN601 struct {
	Type_ TypeN740 `json:"type"`
	Data  any      `json:"data,omitempty"`
}

// TypeN605 is QAPI object 605.
type TypeN605 struct {
	Event       TypeN746  `json:"event"`
	State       *int64    `json:"state,omitempty"`
	Iotype      *TypeN747 `json:"iotype,omitempty"`
	Errno       *int64    `json:"errno,omitempty"`
	DelayNs     *int64    `json:"delay-ns,omitempty"`
	Sector      *int64    `json:"sector,omitempty"`
	Once        *bool     `json:"once,omitempty"`
	Immediately *bool     `json:"immediately,omitempty"`
}

// TypeN606 is QAPI object 606.
type TypeN606 struct {
	Event    TypeN746 `json:"event"`
	State    *int64   `json:"state,omitempty"`
	NewState int64    `json:"new_state"`
}

// TypeN619 is QAPI object 619.
type TypeN619 struct {
	Host string `json:"host"`
	Port string `json:"port"`
}

// TypeN660 is QAPI object 660.
type TypeN660 struct {
	Str string `json:"str"`
}

// TypeN661 is QAPI object 661.
type TypeN661 struct {
	Str string `json:"str"`
}

// TypeN662 is QAPI object 662.
type TypeN662 struct {
	Str string `json:"str"`
}

// TypeN663 is QAPI object 663.
type TypeN663 struct {
	Str string `json:"str"`
}

// TypeN664 is QAPI object 664.
type TypeN664 struct {
	Str string `json:"str"`
}

// TypeN665 is QAPI object 665.
type TypeN665 struct {
	Str string `json:"str"`
}

// TypeN670 is QAPI object 670.
type TypeN670 struct {
	Data TypeN791 `json:"data"`
}

// TypeN671 is QAPI object 671.
type TypeN671 struct {
	Data TypeN792 `json:"data"`
}

// TypeN676 is QAPI object 676.
type TypeN676 struct {
	Data TypeN794 `json:"data"`
}

// TypeN677 is QAPI object 677.
type TypeN677 struct {
	Data TypeN795 `json:"data"`
}

// TypeN678 is QAPI object 678.
type TypeN678 struct {
	Data TypeN796 `json:"data"`
}

// TypeN679 is QAPI object 679.
type TypeN679 struct {
	Data TypeN797 `json:"data"`
}

// TypeN681 is QAPI object 681.
type TypeN681 struct {
	Name      string    `json:"name"`
	Alias     string    `json:"alias"`
	Transform *TypeN798 `json:"transform,omitempty"`
}

// TypeN683 is QAPI object 683.
type TypeN683 struct {
	Transport         TypeN799                     `json:"transport"`
	Type_             *NbdServerStartArgsAddrType_ `json:"type,omitempty"`
	Args              []string                     `json:"args,omitempty"`
	Host              *string                      `json:"host,omitempty"`
	Port              *string                      `json:"port,omitempty"`
	Numeric           *bool                        `json:"numeric,omitempty"`
	To                *int64                       `json:"to,omitempty"`
	Ipv4              *bool                        `json:"ipv4,omitempty"`
	Ipv6              *bool                        `json:"ipv6,omitempty"`
	KeepAlive         *bool                        `json:"keep-alive,omitempty"`
	KeepAliveCount    *int64                       `json:"keep-alive-count,omitempty"`
	KeepAliveIdle     *int64                       `json:"keep-alive-idle,omitempty"`
	KeepAliveInterval *int64                       `json:"keep-alive-interval,omitempty"`
	Mptcp             *bool                        `json:"mptcp,omitempty"`
	Filename          *string                      `json:"filename,omitempty"`
	Offset            *int64                       `json:"offset,omitempty"`
}

// TypeN685 is QAPI object 685.
type TypeN685 struct {
	Data TypeN802 `json:"data"`
}

// TypeN686 is QAPI object 686.
type TypeN686 struct {
	Data BlockDirtyBitmapAddArgs `json:"data"`
}

// TypeN687 is QAPI object 687.
type TypeN687 struct {
	Data BlockDirtyBitmapRemoveArgs `json:"data"`
}

// TypeN688 is QAPI object 688.
type TypeN688 struct {
	Data BlockDirtyBitmapMergeArgs `json:"data"`
}

// TypeN689 is QAPI object 689.
type TypeN689 struct {
	Data BlockdevBackupArgs `json:"data"`
}

// TypeN690 is QAPI object 690.
type TypeN690 struct {
	Data BlockdevSnapshotArgs `json:"data"`
}

// TypeN691 is QAPI object 691.
type TypeN691 struct {
	Data BlockdevSnapshotInternalSyncArgs `json:"data"`
}

// TypeN692 is QAPI object 692.
type TypeN692 struct {
	Data BlockdevSnapshotSyncArgs `json:"data"`
}

// TypeN693 is QAPI object 693.
type TypeN693 struct {
	Data DriveBackupArgs `json:"data"`
}

// TypeN696 is QAPI object 696.
type TypeN696 struct {
	Name     string   `json:"name"`
	Features []string `json:"features,omitempty"`
}

// TypeN697 is QAPI object 697.
type TypeN697 struct {
	Name     string   `json:"name"`
	Type_    string   `json:"type"`
	Default_ any      `json:"default,omitempty"`
	Features []string `json:"features,omitempty"`
}

// TypeN698 is QAPI object 698.
type TypeN698 struct {
	Case_ string `json:"case"`
	Type_ string `json:"type"`
}

// TypeN699 is QAPI object 699.
type TypeN699 struct {
	Type_ string `json:"type"`
}

// TypeN701 is QAPI object 701.
type TypeN701 struct {
	Match  string                       `json:"match"`
	Policy ObjectAddArgsAuthzListPolicy `json:"policy"`
	Format *TypeN803                    `json:"format,omitempty"`
}

// TypeN714 is QAPI object 714.
type TypeN714 struct {
	Id           *string `json:"id,omitempty"`
	Addr         int64   `json:"addr"`
	Size         int64   `json:"size"`
	Slot         int64   `json:"slot"`
	Node         int64   `json:"node"`
	Memdev       string  `json:"memdev"`
	Hotplugged   bool    `json:"hotplugged"`
	Hotpluggable bool    `json:"hotpluggable"`
}

// TypeN715 is QAPI object 715.
type TypeN715 struct {
	Id      *string `json:"id,omitempty"`
	Memaddr int64   `json:"memaddr"`
	Size    int64   `json:"size"`
	Memdev  string  `json:"memdev"`
}

// TypeN716 is QAPI object 716.
type TypeN716 struct {
	Id            *string `json:"id,omitempty"`
	Memaddr       int64   `json:"memaddr"`
	RequestedSize int64   `json:"requested-size"`
	Size          int64   `json:"size"`
	MaxSize       int64   `json:"max-size"`
	BlockSize     int64   `json:"block-size"`
	Node          int64   `json:"node"`
	Memdev        string  `json:"memdev"`
}

// TypeN717 is QAPI object 717.
type TypeN717 struct {
	Id      *string `json:"id,omitempty"`
	Memaddr int64   `json:"memaddr"`
	Size    int64   `json:"size"`
	Node    int64   `json:"node"`
	Memdev  string  `json:"memdev"`
}

// TypeN718 is QAPI object 718.
type TypeN718 struct {
	Id      *string `json:"id,omitempty"`
	Memaddr *int64  `json:"memaddr,omitempty"`
	MaxSize int64   `json:"max-size"`
	Memdev  *string `json:"memdev,omitempty"`
}

// TypeN719 is QAPI object 719.
type TypeN719 struct {
	Id     *string `json:"id,omitempty"`
	Addr   int64   `json:"addr"`
	Size   int64   `json:"size"`
	Node   int64   `json:"node"`
	Memdev string  `json:"memdev"`
}

// TypeN721 is QAPI object 721.
type TypeN721 struct {
	MixingEngine  *bool     `json:"mixing-engine,omitempty"`
	FixedSettings *bool     `json:"fixed-settings,omitempty"`
	Frequency     *int64    `json:"frequency,omitempty"`
	Channels      *int64    `json:"channels,omitempty"`
	Voices        *int64    `json:"voices,omitempty"`
	Format        *TypeN804 `json:"format,omitempty"`
	BufferLength  *int64    `json:"buffer-length,omitempty"`
}

// TypeN722 is QAPI object 722.
type TypeN722 struct {
	MixingEngine  *bool     `json:"mixing-engine,omitempty"`
	FixedSettings *bool     `json:"fixed-settings,omitempty"`
	Frequency     *int64    `json:"frequency,omitempty"`
	Channels      *int64    `json:"channels,omitempty"`
	Voices        *int64    `json:"voices,omitempty"`
	Format        *TypeN804 `json:"format,omitempty"`
	BufferLength  *int64    `json:"buffer-length,omitempty"`
	Dev           *string   `json:"dev,omitempty"`
	PeriodLength  *int64    `json:"period-length,omitempty"`
	TryPoll       *bool     `json:"try-poll,omitempty"`
}

// TypeN723 is QAPI object 723.
type TypeN723 struct {
	MixingEngine  *bool     `json:"mixing-engine,omitempty"`
	FixedSettings *bool     `json:"fixed-settings,omitempty"`
	Frequency     *int64    `json:"frequency,omitempty"`
	Channels      *int64    `json:"channels,omitempty"`
	Voices        *int64    `json:"voices,omitempty"`
	Format        *TypeN804 `json:"format,omitempty"`
	BufferLength  *int64    `json:"buffer-length,omitempty"`
	BufferCount   *int64    `json:"buffer-count,omitempty"`
}

// TypeN724 is QAPI object 724.
type TypeN724 struct {
	MixingEngine  *bool     `json:"mixing-engine,omitempty"`
	FixedSettings *bool     `json:"fixed-settings,omitempty"`
	Frequency     *int64    `json:"frequency,omitempty"`
	Channels      *int64    `json:"channels,omitempty"`
	Voices        *int64    `json:"voices,omitempty"`
	Format        *TypeN804 `json:"format,omitempty"`
	BufferLength  *int64    `json:"buffer-length,omitempty"`
	ServerName    *string   `json:"server-name,omitempty"`
	ClientName    *string   `json:"client-name,omitempty"`
	ConnectPorts  *string   `json:"connect-ports,omitempty"`
	StartServer   *bool     `json:"start-server,omitempty"`
	ExactName     *bool     `json:"exact-name,omitempty"`
}

// TypeN725 is QAPI object 725.
type TypeN725 struct {
	MixingEngine  *bool     `json:"mixing-engine,omitempty"`
	FixedSettings *bool     `json:"fixed-settings,omitempty"`
	Frequency     *int64    `json:"frequency,omitempty"`
	Channels      *int64    `json:"channels,omitempty"`
	Voices        *int64    `json:"voices,omitempty"`
	Format        *TypeN804 `json:"format,omitempty"`
	BufferLength  *int64    `json:"buffer-length,omitempty"`
	Dev           *string   `json:"dev,omitempty"`
	BufferCount   *int64    `json:"buffer-count,omitempty"`
	TryPoll       *bool     `json:"try-poll,omitempty"`
}

// TypeN726 is QAPI object 726.
type TypeN726 struct {
	MixingEngine  *bool     `json:"mixing-engine,omitempty"`
	FixedSettings *bool     `json:"fixed-settings,omitempty"`
	Frequency     *int64    `json:"frequency,omitempty"`
	Channels      *int64    `json:"channels,omitempty"`
	Voices        *int64    `json:"voices,omitempty"`
	Format        *TypeN804 `json:"format,omitempty"`
	BufferLength  *int64    `json:"buffer-length,omitempty"`
	Name          *string   `json:"name,omitempty"`
	StreamName    *string   `json:"stream-name,omitempty"`
	Latency       *int64    `json:"latency,omitempty"`
}

// TypeN727 is QAPI object 727.
type TypeN727 struct {
	MixingEngine  *bool     `json:"mixing-engine,omitempty"`
	FixedSettings *bool     `json:"fixed-settings,omitempty"`
	Frequency     *int64    `json:"frequency,omitempty"`
	Channels      *int64    `json:"channels,omitempty"`
	Voices        *int64    `json:"voices,omitempty"`
	Format        *TypeN804 `json:"format,omitempty"`
	BufferLength  *int64    `json:"buffer-length,omitempty"`
	Name          *string   `json:"name,omitempty"`
	StreamName    *string   `json:"stream-name,omitempty"`
	Latency       *int64    `json:"latency,omitempty"`
}

// TypeN728 is QAPI object 728.
type TypeN728 struct {
	MixingEngine  *bool     `json:"mixing-engine,omitempty"`
	FixedSettings *bool     `json:"fixed-settings,omitempty"`
	Frequency     *int64    `json:"frequency,omitempty"`
	Channels      *int64    `json:"channels,omitempty"`
	Voices        *int64    `json:"voices,omitempty"`
	Format        *TypeN804 `json:"format,omitempty"`
	BufferLength  *int64    `json:"buffer-length,omitempty"`
	BufferCount   *int64    `json:"buffer-count,omitempty"`
}

// TypeN729 is QAPI object 729.
type TypeN729 struct {
	Desc  *string `json:"desc,omitempty"`
	Class int64   `json:"class"`
}

// TypeN730 is QAPI object 730.
type TypeN730 struct {
	Device          int64  `json:"device"`
	Vendor          int64  `json:"vendor"`
	Subsystem       *int64 `json:"subsystem,omitempty"`
	SubsystemVendor *int64 `json:"subsystem-vendor,omitempty"`
}

// TypeN731 is QAPI object 731.
type TypeN731 struct {
	Bus     TypeN805   `json:"bus"`
	Devices []TypeN569 `json:"devices,omitempty"`
}

// TypeN732 is QAPI object 732.
type TypeN732 struct {
	Bar       int64  `json:"bar"`
	Type_     string `json:"type"`
	Address   int64  `json:"address"`
	Size      int64  `json:"size"`
	Prefetch  *bool  `json:"prefetch,omitempty"`
	MemType64 *bool  `json:"mem_type_64,omitempty"`
}

// TypeN741 is QAPI object 741.
type TypeN741 struct {
	Data TypeN806 `json:"data"`
}

// TypeN742 is QAPI object 742.
type TypeN742 struct {
	Data TypeN807 `json:"data"`
}

// TypeN743 is QAPI object 743.
type TypeN743 struct {
	Data TypeN808 `json:"data"`
}

// TypeN744 is QAPI object 744.
type TypeN744 struct {
	Data TypeN809 `json:"data"`
}

// TypeN745 is QAPI object 745.
type TypeN745 struct {
	Data TypeN810 `json:"data"`
}

// TypeN791 is QAPI object 791.
type TypeN791 struct {
	Path       *string `json:"path,omitempty"`
	CancelPath *string `json:"cancel-path,omitempty"`
}

// TypeN792 is QAPI object 792.
type TypeN792 struct {
	Chardev string `json:"chardev"`
}

// TypeN794 is QAPI object 794.
type TypeN794 struct {
	Key  KeyValue `json:"key"`
	Down bool     `json:"down"`
}

// TypeN795 is QAPI object 795.
type TypeN795 struct {
	Button TypeN818 `json:"button"`
	Down   bool     `json:"down"`
}

// TypeN796 is QAPI object 796.
type TypeN796 struct {
	Axis  TypeN819 `json:"axis"`
	Value int64    `json:"value"`
}

// TypeN797 is QAPI object 797.
type TypeN797 struct {
	Type_      TypeN820 `json:"type"`
	Slot       int64    `json:"slot"`
	TrackingId int64    `json:"tracking-id"`
	Axis       TypeN819 `json:"axis"`
	Value      int64    `json:"value"`
}

// TypeN798 is QAPI object 798.
type TypeN798 struct {
	Persistent *bool `json:"persistent,omitempty"`
}

// TypeN800 is QAPI object 800.
type TypeN800 struct {
	Args []string `json:"args"`
}

// TypeN801 is QAPI object 801.
type TypeN801 struct {
	Filename string `json:"filename"`
	Offset   int64  `json:"offset"`
}

// TypeN802 is QAPI object 802.
type TypeN802 struct {
}

// TypeN805 is QAPI object 805.
type TypeN805 struct {
	Number            int64    `json:"number"`
	Secondary         int64    `json:"secondary"`
	Subordinate       int64    `json:"subordinate"`
	IoRange           TypeN821 `json:"io_range"`
	MemoryRange       TypeN821 `json:"memory_range"`
	PrefetchableRange TypeN821 `json:"prefetchable_range"`
}

// TypeN806 is QAPI object 806.
type TypeN806 struct {
	Compat          string                                        `json:"compat"`
	DataFile        *string                                       `json:"data-file,omitempty"`
	DataFileRaw     *bool                                         `json:"data-file-raw,omitempty"`
	ExtendedL2      *bool                                         `json:"extended-l2,omitempty"`
	LazyRefcounts   *bool                                         `json:"lazy-refcounts,omitempty"`
	Corrupt         *bool                                         `json:"corrupt,omitempty"`
	RefcountBits    int64                                         `json:"refcount-bits"`
	Encrypt         *TypeN822                                     `json:"encrypt,omitempty"`
	Bitmaps         []TypeN823                                    `json:"bitmaps,omitempty"`
	CompressionType BlockdevCreateArgsOptionsQcow2CompressionType `json:"compression-type"`
}

// TypeN807 is QAPI object 807.
type TypeN807 struct {
	CreateType string     `json:"create-type"`
	Cid        int64      `json:"cid"`
	ParentCid  int64      `json:"parent-cid"`
	Extents    []TypeN824 `json:"extents"`
}

// TypeN808 is QAPI object 808.
type TypeN808 struct {
	CipherAlg      BlockdevCreateArgsOptionsLuksCipherAlg     `json:"cipher-alg"`
	CipherMode     BlockdevCreateArgsOptionsLuksCipherMode    `json:"cipher-mode"`
	IvgenAlg       BlockdevCreateArgsOptionsLuksIvgenAlg      `json:"ivgen-alg"`
	IvgenHashAlg   *BlockdevCreateArgsOptionsLuksIvgenHashAlg `json:"ivgen-hash-alg,omitempty"`
	HashAlg        BlockdevCreateArgsOptionsLuksIvgenHashAlg  `json:"hash-alg"`
	DetachedHeader bool                                       `json:"detached-header"`
	PayloadOffset  int64                                      `json:"payload-offset"`
	MasterKeyIters int64                                      `json:"master-key-iters"`
	Uuid           string                                     `json:"uuid"`
	Slots          []TypeN825                                 `json:"slots"`
}

// TypeN809 is QAPI object 809.
type TypeN809 struct {
	EncryptionFormat *BlockdevAddArgsRbdEncryptFormat `json:"encryption-format,omitempty"`
}

// TypeN810 is QAPI object 810.
type TypeN810 struct {
	ExtentSizeHint *int64 `json:"extent-size-hint,omitempty"`
}

// TypeN821 is QAPI object 821.
type TypeN821 struct {
	Base  int64 `json:"base"`
	Limit int64 `json:"limit"`
}

// TypeN822 is QAPI object 822.
type TypeN822 struct {
	Format         BlockdevAddArgsQcow2EncryptFormat          `json:"format"`
	CipherAlg      *BlockdevCreateArgsOptionsLuksCipherAlg    `json:"cipher-alg,omitempty"`
	CipherMode     *BlockdevCreateArgsOptionsLuksCipherMode   `json:"cipher-mode,omitempty"`
	IvgenAlg       *BlockdevCreateArgsOptionsLuksIvgenAlg     `json:"ivgen-alg,omitempty"`
	IvgenHashAlg   *BlockdevCreateArgsOptionsLuksIvgenHashAlg `json:"ivgen-hash-alg,omitempty"`
	HashAlg        *BlockdevCreateArgsOptionsLuksIvgenHashAlg `json:"hash-alg,omitempty"`
	DetachedHeader *bool                                      `json:"detached-header,omitempty"`
	PayloadOffset  *int64                                     `json:"payload-offset,omitempty"`
	MasterKeyIters *int64                                     `json:"master-key-iters,omitempty"`
	Uuid           *string                                    `json:"uuid,omitempty"`
	Slots          []TypeN825                                 `json:"slots,omitempty"`
}

// TypeN823 is QAPI object 823.
type TypeN823 struct {
	Name        string     `json:"name"`
	Granularity int64      `json:"granularity"`
	Flags       []TypeN826 `json:"flags"`
}

// TypeN824 is QAPI object 824.
type TypeN824 struct {
	Filename    string `json:"filename"`
	Format      string `json:"format"`
	VirtualSize int64  `json:"virtual-size"`
	ClusterSize *int64 `json:"cluster-size,omitempty"`
	Compressed  *bool  `json:"compressed,omitempty"`
}

// TypeN825 is QAPI object 825.
type TypeN825 struct {
	Active    bool   `json:"active"`
	Iters     *int64 `json:"iters,omitempty"`
	Stripes   *int64 `json:"stripes,omitempty"`
	KeyOffset int64  `json:"key-offset"`
}

// TypeN90 is QAPI object 90.
type TypeN90 struct {
	Id           string                  `json:"id"`
	Type_        BlockExportAddArgsType_ `json:"type"`
	NodeName     string                  `json:"node-name"`
	ShuttingDown bool                    `json:"shutting-down"`
}

// TypeN91 is QAPI object 91.
type TypeN91 struct {
	Label        string `json:"label"`
	Filename     string `json:"filename"`
	FrontendOpen bool   `json:"frontend-open"`
}

// TypeN92 is QAPI object 92.
type TypeN92 struct {
	Name string `json:"name"`
}

// UNPLUGPRIMARYEvent is QAPI object 167.
type UNPLUGPRIMARYEvent struct {
	DeviceId string `json:"device-id"`
}

// VFIOMIGRATIONEvent is QAPI object 283.
type VFIOMIGRATIONEvent struct {
	DeviceId    string                        `json:"device-id"`
	QomPath     string                        `json:"qom-path"`
	DeviceState VFIOMIGRATIONEventDeviceState `json:"device-state"`
}

// VFUCLIENTHANGUPEvent is QAPI object 254.
type VFUCLIENTHANGUPEvent struct {
	VfuId      string `json:"vfu-id"`
	VfuQomPath string `json:"vfu-qom-path"`
	DevId      string `json:"dev-id"`
	DevQomPath string `json:"dev-qom-path"`
}

// VNCCONNECTEDEvent is QAPI object 140.
type VNCCONNECTEDEvent struct {
	Server VNCCONNECTEDEventServer `json:"server"`
	Client VNCCONNECTEDEventClient `json:"client"`
}

// VNCCONNECTEDEventClient is QAPI object 426.
type VNCCONNECTEDEventClient struct {
	Host      string               `json:"host"`
	Service   string               `json:"service"`
	Family    QueryVncResultFamily `json:"family"`
	Websocket bool                 `json:"websocket"`
}

// VNCCONNECTEDEventServer is QAPI object 425.
type VNCCONNECTEDEventServer struct {
	Host      string               `json:"host"`
	Service   string               `json:"service"`
	Family    QueryVncResultFamily `json:"family"`
	Websocket bool                 `json:"websocket"`
	Auth      *string              `json:"auth,omitempty"`
}

// VNCDISCONNECTEDEvent is QAPI object 142.
type VNCDISCONNECTEDEvent struct {
	Server VNCCONNECTEDEventServer   `json:"server"`
	Client VNCINITIALIZEDEventClient `json:"client"`
}

// VNCINITIALIZEDEvent is QAPI object 141.
type VNCINITIALIZEDEvent struct {
	Server VNCCONNECTEDEventServer   `json:"server"`
	Client VNCINITIALIZEDEventClient `json:"client"`
}

// VNCINITIALIZEDEventClient is QAPI object 421.
type VNCINITIALIZEDEventClient struct {
	Host         string               `json:"host"`
	Service      string               `json:"service"`
	Family       QueryVncResultFamily `json:"family"`
	Websocket    bool                 `json:"websocket"`
	X509Dname    *string              `json:"x509_dname,omitempty"`
	SaslUsername *string              `json:"sasl_username,omitempty"`
}

// VSERPORTCHANGEEvent is QAPI object 100.
type VSERPORTCHANGEEvent struct {
	Id   string `json:"id"`
	Open bool   `json:"open"`
}

// VersionInfo is QAPI object 182.
type VersionInfo struct {
	Qemu     VersionTriple `json:"qemu"`
	Package_ string        `json:"package"`
}

// VersionTriple is QAPI object 461.
type VersionTriple struct {
	Major int64 `json:"major"`
	Minor int64 `json:"minor"`
	Micro int64 `json:"micro"`
}

// WATCHDOGEvent is QAPI object 4.
type WATCHDOGEvent struct {
	Action WATCHDOGEventAction `json:"action"`
}

// WatchdogSetActionArgs is QAPI object 5.
type WatchdogSetActionArgs struct {
	Action WATCHDOGEventAction `json:"action"`
}

// XAccelStatsResult is QAPI object 19.
type XAccelStatsResult struct {
	HumanReadableText string `json:"human-readable-text"`
}

// XBlockdevAmendArgs is QAPI object 67.
type XBlockdevAmendArgs struct {
	JobId    string                    `json:"job-id"`
	NodeName string                    `json:"node-name"`
	Options  XBlockdevAmendArgsOptions `json:"options"`
	Force    *bool                     `json:"force,omitempty"`
}

// XBlockdevAmendArgsOptions is QAPI object 366.
type XBlockdevAmendArgsOptions struct {
	Driver    BlockdevAddArgsDriver                  `json:"driver"`
	State     *XBlockdevAmendArgsOptionsLuksState    `json:"state,omitempty"`
	NewSecret *string                                `json:"new-secret,omitempty"`
	OldSecret *string                                `json:"old-secret,omitempty"`
	Keyslot   *int64                                 `json:"keyslot,omitempty"`
	IterTime  *int64                                 `json:"iter-time,omitempty"`
	Secret    *string                                `json:"secret,omitempty"`
	Encrypt   *XBlockdevAmendArgsOptionsQcow2Encrypt `json:"encrypt,omitempty"`
}

// XBlockdevAmendArgsOptionsLuks is QAPI object 636.
type XBlockdevAmendArgsOptionsLuks struct {
	State     XBlockdevAmendArgsOptionsLuksState `json:"state"`
	NewSecret *string                            `json:"new-secret,omitempty"`
	OldSecret *string                            `json:"old-secret,omitempty"`
	Keyslot   *int64                             `json:"keyslot,omitempty"`
	IterTime  *int64                             `json:"iter-time,omitempty"`
	Secret    *string                            `json:"secret,omitempty"`
}

// XBlockdevAmendArgsOptionsQcow2 is QAPI object 637.
type XBlockdevAmendArgsOptionsQcow2 struct {
	Encrypt *XBlockdevAmendArgsOptionsQcow2Encrypt `json:"encrypt,omitempty"`
}

// XBlockdevAmendArgsOptionsQcow2Encrypt is QAPI object 775.
type XBlockdevAmendArgsOptionsQcow2Encrypt struct {
	Format    BlockdevCreateArgsOptionsQcowEncryptFormat `json:"format"`
	State     *XBlockdevAmendArgsOptionsLuksState        `json:"state,omitempty"`
	NewSecret *string                                    `json:"new-secret,omitempty"`
	OldSecret *string                                    `json:"old-secret,omitempty"`
	Keyslot   *int64                                     `json:"keyslot,omitempty"`
	IterTime  *int64                                     `json:"iter-time,omitempty"`
	Secret    *string                                    `json:"secret,omitempty"`
}

// XBlockdevAmendArgsOptionsQcow2EncryptLuks is QAPI object 816.
type XBlockdevAmendArgsOptionsQcow2EncryptLuks struct {
	State     XBlockdevAmendArgsOptionsLuksState `json:"state"`
	NewSecret *string                            `json:"new-secret,omitempty"`
	OldSecret *string                            `json:"old-secret,omitempty"`
	Keyslot   *int64                             `json:"keyslot,omitempty"`
	IterTime  *int64                             `json:"iter-time,omitempty"`
	Secret    *string                            `json:"secret,omitempty"`
}

// XBlockdevChangeArgs is QAPI object 77.
type XBlockdevChangeArgs struct {
	Parent string  `json:"parent"`
	Child  *string `json:"child,omitempty"`
	Node   *string `json:"node,omitempty"`
}

// XBlockdevSetIothreadArgs is QAPI object 78.
type XBlockdevSetIothreadArgs struct {
	NodeName string                           `json:"node-name"`
	Iothread XBlockdevSetIothreadArgsIothread `json:"iothread"`
	Force    *bool                            `json:"force,omitempty"`
}

// XDebugBlockDirtyBitmapSha256Result is QAPI object 51.
type XDebugBlockDirtyBitmapSha256Result struct {
	Sha256 string `json:"sha256"`
}

// XDebugQueryBlockGraphResult is QAPI object 46.
type XDebugQueryBlockGraphResult struct {
	Nodes []TypeN323 `json:"nodes"`
	Edges []TypeN324 `json:"edges"`
}

// XQueryVirtioQueueElementArgs is QAPI object 281.
type XQueryVirtioQueueElementArgs struct {
	Path  string `json:"path"`
	Queue int64  `json:"queue"`
	Index *int64 `json:"index,omitempty"`
}

// XQueryVirtioQueueElementResult is QAPI object 282.
type XQueryVirtioQueueElementResult struct {
	Name  string                              `json:"name"`
	Index int64                               `json:"index"`
	Descs []TypeN579                          `json:"descs"`
	Avail XQueryVirtioQueueElementResultAvail `json:"avail"`
	Used  XQueryVirtioQueueElementResultUsed  `json:"used"`
}

// XQueryVirtioQueueElementResultAvail is QAPI object 580.
type XQueryVirtioQueueElementResultAvail struct {
	Flags int64 `json:"flags"`
	Idx   int64 `json:"idx"`
	Ring  int64 `json:"ring"`
}

// XQueryVirtioQueueElementResultUsed is QAPI object 581.
type XQueryVirtioQueueElementResultUsed struct {
	Flags int64 `json:"flags"`
	Idx   int64 `json:"idx"`
}

// XQueryVirtioQueueStatusArgs is QAPI object 277.
type XQueryVirtioQueueStatusArgs struct {
	Path  string `json:"path"`
	Queue int64  `json:"queue"`
}

// XQueryVirtioQueueStatusResult is QAPI object 278.
type XQueryVirtioQueueStatusResult struct {
	Name               string `json:"name"`
	QueueIndex         int64  `json:"queue-index"`
	Inuse              int64  `json:"inuse"`
	VringNum           int64  `json:"vring-num"`
	VringNumDefault    int64  `json:"vring-num-default"`
	VringAlign         int64  `json:"vring-align"`
	VringDesc          int64  `json:"vring-desc"`
	VringAvail         int64  `json:"vring-avail"`
	VringUsed          int64  `json:"vring-used"`
	LastAvailIdx       *int64 `json:"last-avail-idx,omitempty"`
	ShadowAvailIdx     *int64 `json:"shadow-avail-idx,omitempty"`
	UsedIdx            int64  `json:"used-idx"`
	SignalledUsed      int64  `json:"signalled-used"`
	SignalledUsedValid bool   `json:"signalled-used-valid"`
}

// XQueryVirtioStatusArgs is QAPI object 275.
type XQueryVirtioStatusArgs struct {
	Path string `json:"path"`
}

// XQueryVirtioStatusResult is QAPI object 276.
type XQueryVirtioStatusResult struct {
	Name                 string                                `json:"name"`
	DeviceId             int64                                 `json:"device-id"`
	VhostStarted         bool                                  `json:"vhost-started"`
	DeviceEndian         string                                `json:"device-endian"`
	GuestFeatures        XQueryVirtioStatusResultGuestFeatures `json:"guest-features"`
	HostFeatures         XQueryVirtioStatusResultGuestFeatures `json:"host-features"`
	BackendFeatures      XQueryVirtioStatusResultGuestFeatures `json:"backend-features"`
	NumVqs               int64                                 `json:"num-vqs"`
	Status               XQueryVirtioStatusResultStatus        `json:"status"`
	Isr                  int64                                 `json:"isr"`
	QueueSel             int64                                 `json:"queue-sel"`
	VmRunning            bool                                  `json:"vm-running"`
	Broken               bool                                  `json:"broken"`
	Disabled             bool                                  `json:"disabled"`
	UseStarted           bool                                  `json:"use-started"`
	Started              bool                                  `json:"started"`
	StartOnKick          bool                                  `json:"start-on-kick"`
	DisableLegacyCheck   bool                                  `json:"disable-legacy-check"`
	BusName              string                                `json:"bus-name"`
	UseGuestNotifierMask bool                                  `json:"use-guest-notifier-mask"`
	VhostDev             *XQueryVirtioStatusResultVhostDev     `json:"vhost-dev,omitempty"`
}

// XQueryVirtioStatusResultGuestFeatures is QAPI object 576.
type XQueryVirtioStatusResultGuestFeatures struct {
	Transports          []string `json:"transports"`
	DevFeatures         []string `json:"dev-features,omitempty"`
	UnknownDevFeatures  *int64   `json:"unknown-dev-features,omitempty"`
	UnknownDevFeatures2 *int64   `json:"unknown-dev-features2,omitempty"`
}

// XQueryVirtioStatusResultStatus is QAPI object 577.
type XQueryVirtioStatusResultStatus struct {
	Statuses        []string `json:"statuses"`
	UnknownStatuses *int64   `json:"unknown-statuses,omitempty"`
}

// XQueryVirtioStatusResultVhostDev is QAPI object 578.
type XQueryVirtioStatusResultVhostDev struct {
	NMemSections     int64                                            `json:"n-mem-sections"`
	NTmpSections     int64                                            `json:"n-tmp-sections"`
	Nvqs             int64                                            `json:"nvqs"`
	VqIndex          int64                                            `json:"vq-index"`
	Features         XQueryVirtioStatusResultGuestFeatures            `json:"features"`
	AckedFeatures    XQueryVirtioStatusResultGuestFeatures            `json:"acked-features"`
	ProtocolFeatures XQueryVirtioStatusResultVhostDevProtocolFeatures `json:"protocol-features"`
	MaxQueues        int64                                            `json:"max-queues"`
	BackendCap       int64                                            `json:"backend-cap"`
	LogEnabled       bool                                             `json:"log-enabled"`
	LogSize          int64                                            `json:"log-size"`
}

// XQueryVirtioStatusResultVhostDevProtocolFeatures is QAPI object 736.
type XQueryVirtioStatusResultVhostDevProtocolFeatures struct {
	Protocols        []string `json:"protocols"`
	UnknownProtocols *int64   `json:"unknown-protocols,omitempty"`
}

// XQueryVirtioVhostQueueStatusArgs is QAPI object 279.
type XQueryVirtioVhostQueueStatusArgs struct {
	Path  string `json:"path"`
	Queue int64  `json:"queue"`
}

// XQueryVirtioVhostQueueStatusResult is QAPI object 280.
type XQueryVirtioVhostQueueStatusResult struct {
	Name      string `json:"name"`
	Kick      int64  `json:"kick"`
	Call      int64  `json:"call"`
	Num       int64  `json:"num"`
	DescPhys  int64  `json:"desc-phys"`
	DescSize  int64  `json:"desc-size"`
	AvailPhys int64  `json:"avail-phys"`
	AvailSize int64  `json:"avail-size"`
	UsedPhys  int64  `json:"used-phys"`
	UsedSize  int64  `json:"used-size"`
}

// XenEventInjectArgs is QAPI object 264.
type XenEventInjectArgs struct {
	Port int64 `json:"port"`
}

// XenLoadDevicesStateArgs is QAPI object 162.
type XenLoadDevicesStateArgs struct {
	Filename string `json:"filename"`
}

// XenSaveDevicesStateArgs is QAPI object 160.
type XenSaveDevicesStateArgs struct {
	Filename string `json:"filename"`
	Live     *bool  `json:"live,omitempty"`
}

// XenSetGlobalDirtyLogArgs is QAPI object 161.
type XenSetGlobalDirtyLogArgs struct {
	Enable bool `json:"enable"`
}

// XenSetReplicationArgs is QAPI object 163.
type XenSetReplicationArgs struct {
	Enable   bool  `json:"enable"`
	Primary  bool  `json:"primary"`
	Failover *bool `json:"failover,omitempty"`
}

// YankArgs is QAPI object 238.
type YankArgs struct {
	Instances []TypeN239 `json:"instances"`
}

// ACPIDEVICEOSTEventInfoSlotType is QAPI enum 568.
type ACPIDEVICEOSTEventInfoSlotType string

const (
	ACPIDEVICEOSTEventInfoSlotTypeDIMM ACPIDEVICEOSTEventInfoSlotType = "DIMM"
	ACPIDEVICEOSTEventInfoSlotTypeCPU  ACPIDEVICEOSTEventInfoSlotType = "CPU"
)

// BLOCKIOERROREventAction is QAPI enum 368.
type BLOCKIOERROREventAction string

const (
	BLOCKIOERROREventActionIgnore BLOCKIOERROREventAction = "ignore"
	BLOCKIOERROREventActionReport BLOCKIOERROREventAction = "report"
	BLOCKIOERROREventActionStop   BLOCKIOERROREventAction = "stop"
)

// BLOCKIOERROREventOperation is QAPI enum 367.
type BLOCKIOERROREventOperation string

const (
	BLOCKIOERROREventOperationRead  BLOCKIOERROREventOperation = "read"
	BLOCKIOERROREventOperationWrite BLOCKIOERROREventOperation = "write"
)

// BlockCommitArgsOnError is QAPI enum 313.
type BlockCommitArgsOnError string

const (
	BlockCommitArgsOnErrorReport BlockCommitArgsOnError = "report"
	BlockCommitArgsOnErrorIgnore BlockCommitArgsOnError = "ignore"
	BlockCommitArgsOnErrorEnospc BlockCommitArgsOnError = "enospc"
	BlockCommitArgsOnErrorStop   BlockCommitArgsOnError = "stop"
	BlockCommitArgsOnErrorAuto   BlockCommitArgsOnError = "auto"
)

// BlockExportAddArgsFuseAllowOther is QAPI enum 643.
type BlockExportAddArgsFuseAllowOther string

const (
	BlockExportAddArgsFuseAllowOtherOff  BlockExportAddArgsFuseAllowOther = "off"
	BlockExportAddArgsFuseAllowOtherOn   BlockExportAddArgsFuseAllowOther = "on"
	BlockExportAddArgsFuseAllowOtherAuto BlockExportAddArgsFuseAllowOther = "auto"
)

// BlockExportAddArgsType_ is QAPI enum 373.
type BlockExportAddArgsType_ string

const (
	BlockExportAddArgsType_Nbd          BlockExportAddArgsType_ = "nbd"
	BlockExportAddArgsType_VhostUserBlk BlockExportAddArgsType_ = "vhost-user-blk"
	BlockExportAddArgsType_Fuse         BlockExportAddArgsType_ = "fuse"
	BlockExportAddArgsType_VduseBlk     BlockExportAddArgsType_ = "vduse-blk"
)

// BlockJobChangeArgsType_ is QAPI enum 305.
type BlockJobChangeArgsType_ string

const (
	BlockJobChangeArgsType_Commit         BlockJobChangeArgsType_ = "commit"
	BlockJobChangeArgsType_Stream         BlockJobChangeArgsType_ = "stream"
	BlockJobChangeArgsType_Mirror         BlockJobChangeArgsType_ = "mirror"
	BlockJobChangeArgsType_Backup         BlockJobChangeArgsType_ = "backup"
	BlockJobChangeArgsType_Create         BlockJobChangeArgsType_ = "create"
	BlockJobChangeArgsType_Amend          BlockJobChangeArgsType_ = "amend"
	BlockJobChangeArgsType_SnapshotLoad   BlockJobChangeArgsType_ = "snapshot-load"
	BlockJobChangeArgsType_SnapshotSave   BlockJobChangeArgsType_ = "snapshot-save"
	BlockJobChangeArgsType_SnapshotDelete BlockJobChangeArgsType_ = "snapshot-delete"
)

// BlockdevAddArgsDetectZeroes is QAPI enum 319.
type BlockdevAddArgsDetectZeroes string

const (
	BlockdevAddArgsDetectZeroesOff   BlockdevAddArgsDetectZeroes = "off"
	BlockdevAddArgsDetectZeroesOn    BlockdevAddArgsDetectZeroes = "on"
	BlockdevAddArgsDetectZeroesUnmap BlockdevAddArgsDetectZeroes = "unmap"
)

// BlockdevAddArgsDiscard is QAPI enum 329.
type BlockdevAddArgsDiscard string

const (
	BlockdevAddArgsDiscardIgnore BlockdevAddArgsDiscard = "ignore"
	BlockdevAddArgsDiscardUnmap  BlockdevAddArgsDiscard = "unmap"
)

// BlockdevAddArgsDriver is QAPI enum 328.
type BlockdevAddArgsDriver string

const (
	BlockdevAddArgsDriverBlkdebug        BlockdevAddArgsDriver = "blkdebug"
	BlockdevAddArgsDriverBlklogwrites    BlockdevAddArgsDriver = "blklogwrites"
	BlockdevAddArgsDriverBlkreplay       BlockdevAddArgsDriver = "blkreplay"
	BlockdevAddArgsDriverBlkverify       BlockdevAddArgsDriver = "blkverify"
	BlockdevAddArgsDriverBochs           BlockdevAddArgsDriver = "bochs"
	BlockdevAddArgsDriverCloop           BlockdevAddArgsDriver = "cloop"
	BlockdevAddArgsDriverCompress        BlockdevAddArgsDriver = "compress"
	BlockdevAddArgsDriverCopyBeforeWrite BlockdevAddArgsDriver = "copy-before-write"
	BlockdevAddArgsDriverCopyOnRead      BlockdevAddArgsDriver = "copy-on-read"
	BlockdevAddArgsDriverDmg             BlockdevAddArgsDriver = "dmg"
	BlockdevAddArgsDriverFile            BlockdevAddArgsDriver = "file"
	BlockdevAddArgsDriverSnapshotAccess  BlockdevAddArgsDriver = "snapshot-access"
	BlockdevAddArgsDriverFtp             BlockdevAddArgsDriver = "ftp"
	BlockdevAddArgsDriverFtps            BlockdevAddArgsDriver = "ftps"
	BlockdevAddArgsDriverHostCdrom       BlockdevAddArgsDriver = "host_cdrom"
	BlockdevAddArgsDriverHostDevice      BlockdevAddArgsDriver = "host_device"
	BlockdevAddArgsDriverHttp            BlockdevAddArgsDriver = "http"
	BlockdevAddArgsDriverHttps           BlockdevAddArgsDriver = "https"
	BlockdevAddArgsDriverIscsi           BlockdevAddArgsDriver = "iscsi"
	BlockdevAddArgsDriverLuks            BlockdevAddArgsDriver = "luks"
	BlockdevAddArgsDriverNbd             BlockdevAddArgsDriver = "nbd"
	BlockdevAddArgsDriverNfs             BlockdevAddArgsDriver = "nfs"
	BlockdevAddArgsDriverNullAio         BlockdevAddArgsDriver = "null-aio"
	BlockdevAddArgsDriverNullCo          BlockdevAddArgsDriver = "null-co"
	BlockdevAddArgsDriverNvme            BlockdevAddArgsDriver = "nvme"
	BlockdevAddArgsDriverParallels       BlockdevAddArgsDriver = "parallels"
	BlockdevAddArgsDriverPreallocate     BlockdevAddArgsDriver = "preallocate"
	BlockdevAddArgsDriverQcow            BlockdevAddArgsDriver = "qcow"
	BlockdevAddArgsDriverQcow2           BlockdevAddArgsDriver = "qcow2"
	BlockdevAddArgsDriverQed             BlockdevAddArgsDriver = "qed"
	BlockdevAddArgsDriverQuorum          BlockdevAddArgsDriver = "quorum"
	BlockdevAddArgsDriverRaw             BlockdevAddArgsDriver = "raw"
	BlockdevAddArgsDriverRbd             BlockdevAddArgsDriver = "rbd"
	BlockdevAddArgsDriverReplication     BlockdevAddArgsDriver = "replication"
	BlockdevAddArgsDriverSsh             BlockdevAddArgsDriver = "ssh"
	BlockdevAddArgsDriverThrottle        BlockdevAddArgsDriver = "throttle"
	BlockdevAddArgsDriverVdi             BlockdevAddArgsDriver = "vdi"
	BlockdevAddArgsDriverVhdx            BlockdevAddArgsDriver = "vhdx"
	BlockdevAddArgsDriverVmdk            BlockdevAddArgsDriver = "vmdk"
	BlockdevAddArgsDriverVpc             BlockdevAddArgsDriver = "vpc"
	BlockdevAddArgsDriverVvfat           BlockdevAddArgsDriver = "vvfat"
)

// BlockdevAddArgsFileAio is QAPI enum 608.
type BlockdevAddArgsFileAio string

const (
	BlockdevAddArgsFileAioThreads BlockdevAddArgsFileAio = "threads"
	BlockdevAddArgsFileAioNative  BlockdevAddArgsFileAio = "native"
	BlockdevAddArgsFileAioIoUring BlockdevAddArgsFileAio = "io_uring"
)

// BlockdevAddArgsFileLocking is QAPI enum 607.
type BlockdevAddArgsFileLocking string

const (
	BlockdevAddArgsFileLockingAuto BlockdevAddArgsFileLocking = "auto"
	BlockdevAddArgsFileLockingOn   BlockdevAddArgsFileLocking = "on"
	BlockdevAddArgsFileLockingOff  BlockdevAddArgsFileLocking = "off"
)

// BlockdevAddArgsIscsiHeaderDigest is QAPI enum 610.
type BlockdevAddArgsIscsiHeaderDigest string

const (
	BlockdevAddArgsIscsiHeaderDigestCrc32c     BlockdevAddArgsIscsiHeaderDigest = "crc32c"
	BlockdevAddArgsIscsiHeaderDigestNone       BlockdevAddArgsIscsiHeaderDigest = "none"
	BlockdevAddArgsIscsiHeaderDigestCrc32cNone BlockdevAddArgsIscsiHeaderDigest = "crc32c-none"
	BlockdevAddArgsIscsiHeaderDigestNoneCrc32c BlockdevAddArgsIscsiHeaderDigest = "none-crc32c"
)

// BlockdevAddArgsIscsiTransport is QAPI enum 609.
type BlockdevAddArgsIscsiTransport string

const (
	BlockdevAddArgsIscsiTransportTcp  BlockdevAddArgsIscsiTransport = "tcp"
	BlockdevAddArgsIscsiTransportIser BlockdevAddArgsIscsiTransport = "iser"
)

// BlockdevAddArgsNfsServerType_ is QAPI enum 748.
type BlockdevAddArgsNfsServerType_ string

const (
	BlockdevAddArgsNfsServerType_Inet BlockdevAddArgsNfsServerType_ = "inet"
)

// BlockdevAddArgsQcow2EncryptFormat is QAPI enum 751.
type BlockdevAddArgsQcow2EncryptFormat string

const (
	BlockdevAddArgsQcow2EncryptFormatAes  BlockdevAddArgsQcow2EncryptFormat = "aes"
	BlockdevAddArgsQcow2EncryptFormatLuks BlockdevAddArgsQcow2EncryptFormat = "luks"
)

// BlockdevAddArgsQcow2OverlapCheckAlt1 is QAPI enum 750.
type BlockdevAddArgsQcow2OverlapCheckAlt1 string

const (
	BlockdevAddArgsQcow2OverlapCheckAlt1None     BlockdevAddArgsQcow2OverlapCheckAlt1 = "none"
	BlockdevAddArgsQcow2OverlapCheckAlt1Constant BlockdevAddArgsQcow2OverlapCheckAlt1 = "constant"
	BlockdevAddArgsQcow2OverlapCheckAlt1Cached   BlockdevAddArgsQcow2OverlapCheckAlt1 = "cached"
	BlockdevAddArgsQcow2OverlapCheckAlt1All      BlockdevAddArgsQcow2OverlapCheckAlt1 = "all"
)

// BlockdevAddArgsQcowEncryptFormat is QAPI enum 754.
type BlockdevAddArgsQcowEncryptFormat string

const (
	BlockdevAddArgsQcowEncryptFormatAes BlockdevAddArgsQcowEncryptFormat = "aes"
)

// BlockdevAddArgsQuorumReadPattern is QAPI enum 616.
type BlockdevAddArgsQuorumReadPattern string

const (
	BlockdevAddArgsQuorumReadPatternQuorum BlockdevAddArgsQuorumReadPattern = "quorum"
	BlockdevAddArgsQuorumReadPatternFifo   BlockdevAddArgsQuorumReadPattern = "fifo"
)

// BlockdevAddArgsRbdEncryptFormat is QAPI enum 755.
type BlockdevAddArgsRbdEncryptFormat string

const (
	BlockdevAddArgsRbdEncryptFormatLuks    BlockdevAddArgsRbdEncryptFormat = "luks"
	BlockdevAddArgsRbdEncryptFormatLuks2   BlockdevAddArgsRbdEncryptFormat = "luks2"
	BlockdevAddArgsRbdEncryptFormatLuksAny BlockdevAddArgsRbdEncryptFormat = "luks-any"
)

// BlockdevAddArgsReplicationMode is QAPI enum 620.
type BlockdevAddArgsReplicationMode string

const (
	BlockdevAddArgsReplicationModePrimary   BlockdevAddArgsReplicationMode = "primary"
	BlockdevAddArgsReplicationModeSecondary BlockdevAddArgsReplicationMode = "secondary"
)

// BlockdevAddArgsSshHostKeyCheckHashType_ is QAPI enum 811.
type BlockdevAddArgsSshHostKeyCheckHashType_ string

const (
	BlockdevAddArgsSshHostKeyCheckHashType_Md5    BlockdevAddArgsSshHostKeyCheckHashType_ = "md5"
	BlockdevAddArgsSshHostKeyCheckHashType_Sha1   BlockdevAddArgsSshHostKeyCheckHashType_ = "sha1"
	BlockdevAddArgsSshHostKeyCheckHashType_Sha256 BlockdevAddArgsSshHostKeyCheckHashType_ = "sha256"
)

// BlockdevAddArgsSshHostKeyCheckMode is QAPI enum 759.
type BlockdevAddArgsSshHostKeyCheckMode string

const (
	BlockdevAddArgsSshHostKeyCheckModeNone       BlockdevAddArgsSshHostKeyCheckMode = "none"
	BlockdevAddArgsSshHostKeyCheckModeHash       BlockdevAddArgsSshHostKeyCheckMode = "hash"
	BlockdevAddArgsSshHostKeyCheckModeKnownHosts BlockdevAddArgsSshHostKeyCheckMode = "known_hosts"
)

// BlockdevChangeMediumArgsReadOnlyMode is QAPI enum 307.
type BlockdevChangeMediumArgsReadOnlyMode string

const (
	BlockdevChangeMediumArgsReadOnlyModeRetain    BlockdevChangeMediumArgsReadOnlyMode = "retain"
	BlockdevChangeMediumArgsReadOnlyModeReadOnly  BlockdevChangeMediumArgsReadOnlyMode = "read-only"
	BlockdevChangeMediumArgsReadOnlyModeReadWrite BlockdevChangeMediumArgsReadOnlyMode = "read-write"
)

// BlockdevCreateArgsOptionsFilePreallocation is QAPI enum 761.
type BlockdevCreateArgsOptionsFilePreallocation string

const (
	BlockdevCreateArgsOptionsFilePreallocationOff      BlockdevCreateArgsOptionsFilePreallocation = "off"
	BlockdevCreateArgsOptionsFilePreallocationMetadata BlockdevCreateArgsOptionsFilePreallocation = "metadata"
	BlockdevCreateArgsOptionsFilePreallocationFalloc   BlockdevCreateArgsOptionsFilePreallocation = "falloc"
	BlockdevCreateArgsOptionsFilePreallocationFull     BlockdevCreateArgsOptionsFilePreallocation = "full"
)

// BlockdevCreateArgsOptionsLuksCipherAlg is QAPI enum 762.
type BlockdevCreateArgsOptionsLuksCipherAlg string

const (
	BlockdevCreateArgsOptionsLuksCipherAlgAes128     BlockdevCreateArgsOptionsLuksCipherAlg = "aes-128"
	BlockdevCreateArgsOptionsLuksCipherAlgAes192     BlockdevCreateArgsOptionsLuksCipherAlg = "aes-192"
	BlockdevCreateArgsOptionsLuksCipherAlgAes256     BlockdevCreateArgsOptionsLuksCipherAlg = "aes-256"
	BlockdevCreateArgsOptionsLuksCipherAlgDes        BlockdevCreateArgsOptionsLuksCipherAlg = "des"
	BlockdevCreateArgsOptionsLuksCipherAlgN3des      BlockdevCreateArgsOptionsLuksCipherAlg = "3des"
	BlockdevCreateArgsOptionsLuksCipherAlgCast5128   BlockdevCreateArgsOptionsLuksCipherAlg = "cast5-128"
	BlockdevCreateArgsOptionsLuksCipherAlgSerpent128 BlockdevCreateArgsOptionsLuksCipherAlg = "serpent-128"
	BlockdevCreateArgsOptionsLuksCipherAlgSerpent192 BlockdevCreateArgsOptionsLuksCipherAlg = "serpent-192"
	BlockdevCreateArgsOptionsLuksCipherAlgSerpent256 BlockdevCreateArgsOptionsLuksCipherAlg = "serpent-256"
	BlockdevCreateArgsOptionsLuksCipherAlgTwofish128 BlockdevCreateArgsOptionsLuksCipherAlg = "twofish-128"
	BlockdevCreateArgsOptionsLuksCipherAlgTwofish192 BlockdevCreateArgsOptionsLuksCipherAlg = "twofish-192"
	BlockdevCreateArgsOptionsLuksCipherAlgTwofish256 BlockdevCreateArgsOptionsLuksCipherAlg = "twofish-256"
	BlockdevCreateArgsOptionsLuksCipherAlgSm4        BlockdevCreateArgsOptionsLuksCipherAlg = "sm4"
)

// BlockdevCreateArgsOptionsLuksCipherMode is QAPI enum 763.
type BlockdevCreateArgsOptionsLuksCipherMode string

const (
	BlockdevCreateArgsOptionsLuksCipherModeEcb BlockdevCreateArgsOptionsLuksCipherMode = "ecb"
	BlockdevCreateArgsOptionsLuksCipherModeCbc BlockdevCreateArgsOptionsLuksCipherMode = "cbc"
	BlockdevCreateArgsOptionsLuksCipherModeXts BlockdevCreateArgsOptionsLuksCipherMode = "xts"
	BlockdevCreateArgsOptionsLuksCipherModeCtr BlockdevCreateArgsOptionsLuksCipherMode = "ctr"
)

// BlockdevCreateArgsOptionsLuksIvgenAlg is QAPI enum 764.
type BlockdevCreateArgsOptionsLuksIvgenAlg string

const (
	BlockdevCreateArgsOptionsLuksIvgenAlgPlain   BlockdevCreateArgsOptionsLuksIvgenAlg = "plain"
	BlockdevCreateArgsOptionsLuksIvgenAlgPlain64 BlockdevCreateArgsOptionsLuksIvgenAlg = "plain64"
	BlockdevCreateArgsOptionsLuksIvgenAlgEssiv   BlockdevCreateArgsOptionsLuksIvgenAlg = "essiv"
)

// BlockdevCreateArgsOptionsLuksIvgenHashAlg is QAPI enum 765.
type BlockdevCreateArgsOptionsLuksIvgenHashAlg string

const (
	BlockdevCreateArgsOptionsLuksIvgenHashAlgMd5       BlockdevCreateArgsOptionsLuksIvgenHashAlg = "md5"
	BlockdevCreateArgsOptionsLuksIvgenHashAlgSha1      BlockdevCreateArgsOptionsLuksIvgenHashAlg = "sha1"
	BlockdevCreateArgsOptionsLuksIvgenHashAlgSha224    BlockdevCreateArgsOptionsLuksIvgenHashAlg = "sha224"
	BlockdevCreateArgsOptionsLuksIvgenHashAlgSha256    BlockdevCreateArgsOptionsLuksIvgenHashAlg = "sha256"
	BlockdevCreateArgsOptionsLuksIvgenHashAlgSha384    BlockdevCreateArgsOptionsLuksIvgenHashAlg = "sha384"
	BlockdevCreateArgsOptionsLuksIvgenHashAlgSha512    BlockdevCreateArgsOptionsLuksIvgenHashAlg = "sha512"
	BlockdevCreateArgsOptionsLuksIvgenHashAlgRipemd160 BlockdevCreateArgsOptionsLuksIvgenHashAlg = "ripemd160"
	BlockdevCreateArgsOptionsLuksIvgenHashAlgSm3       BlockdevCreateArgsOptionsLuksIvgenHashAlg = "sm3"
)

// BlockdevCreateArgsOptionsQcow2CompressionType is QAPI enum 768.
type BlockdevCreateArgsOptionsQcow2CompressionType string

const (
	BlockdevCreateArgsOptionsQcow2CompressionTypeZlib BlockdevCreateArgsOptionsQcow2CompressionType = "zlib"
	BlockdevCreateArgsOptionsQcow2CompressionTypeZstd BlockdevCreateArgsOptionsQcow2CompressionType = "zstd"
)

// BlockdevCreateArgsOptionsQcow2Version is QAPI enum 767.
type BlockdevCreateArgsOptionsQcow2Version string

const (
	BlockdevCreateArgsOptionsQcow2VersionV2 BlockdevCreateArgsOptionsQcow2Version = "v2"
	BlockdevCreateArgsOptionsQcow2VersionV3 BlockdevCreateArgsOptionsQcow2Version = "v3"
)

// BlockdevCreateArgsOptionsQcowEncryptFormat is QAPI enum 812.
type BlockdevCreateArgsOptionsQcowEncryptFormat string

const (
	BlockdevCreateArgsOptionsQcowEncryptFormatQcow BlockdevCreateArgsOptionsQcowEncryptFormat = "qcow"
	BlockdevCreateArgsOptionsQcowEncryptFormatLuks BlockdevCreateArgsOptionsQcowEncryptFormat = "luks"
)

// BlockdevCreateArgsOptionsVhdxSubformat is QAPI enum 770.
type BlockdevCreateArgsOptionsVhdxSubformat string

const (
	BlockdevCreateArgsOptionsVhdxSubformatDynamic BlockdevCreateArgsOptionsVhdxSubformat = "dynamic"
	BlockdevCreateArgsOptionsVhdxSubformatFixed   BlockdevCreateArgsOptionsVhdxSubformat = "fixed"
)

// BlockdevCreateArgsOptionsVmdkAdapterType is QAPI enum 772.
type BlockdevCreateArgsOptionsVmdkAdapterType string

const (
	BlockdevCreateArgsOptionsVmdkAdapterTypeIde       BlockdevCreateArgsOptionsVmdkAdapterType = "ide"
	BlockdevCreateArgsOptionsVmdkAdapterTypeBuslogic  BlockdevCreateArgsOptionsVmdkAdapterType = "buslogic"
	BlockdevCreateArgsOptionsVmdkAdapterTypeLsilogic  BlockdevCreateArgsOptionsVmdkAdapterType = "lsilogic"
	BlockdevCreateArgsOptionsVmdkAdapterTypeLegacyESX BlockdevCreateArgsOptionsVmdkAdapterType = "legacyESX"
)

// BlockdevCreateArgsOptionsVmdkSubformat is QAPI enum 771.
type BlockdevCreateArgsOptionsVmdkSubformat string

const (
	BlockdevCreateArgsOptionsVmdkSubformatMonolithicSparse     BlockdevCreateArgsOptionsVmdkSubformat = "monolithicSparse"
	BlockdevCreateArgsOptionsVmdkSubformatMonolithicFlat       BlockdevCreateArgsOptionsVmdkSubformat = "monolithicFlat"
	BlockdevCreateArgsOptionsVmdkSubformatTwoGbMaxExtentSparse BlockdevCreateArgsOptionsVmdkSubformat = "twoGbMaxExtentSparse"
	BlockdevCreateArgsOptionsVmdkSubformatTwoGbMaxExtentFlat   BlockdevCreateArgsOptionsVmdkSubformat = "twoGbMaxExtentFlat"
	BlockdevCreateArgsOptionsVmdkSubformatStreamOptimized      BlockdevCreateArgsOptionsVmdkSubformat = "streamOptimized"
)

// BlockdevCreateArgsOptionsVpcSubformat is QAPI enum 773.
type BlockdevCreateArgsOptionsVpcSubformat string

const (
	BlockdevCreateArgsOptionsVpcSubformatDynamic BlockdevCreateArgsOptionsVpcSubformat = "dynamic"
	BlockdevCreateArgsOptionsVpcSubformatFixed   BlockdevCreateArgsOptionsVpcSubformat = "fixed"
)

// BlockdevSnapshotSyncArgsMode is QAPI enum 312.
type BlockdevSnapshotSyncArgsMode string

const (
	BlockdevSnapshotSyncArgsModeExisting      BlockdevSnapshotSyncArgsMode = "existing"
	BlockdevSnapshotSyncArgsModeAbsolutePaths BlockdevSnapshotSyncArgsMode = "absolute-paths"
)

// COLOEXITEventMode is QAPI enum 450.
type COLOEXITEventMode string

const (
	COLOEXITEventModeNone      COLOEXITEventMode = "none"
	COLOEXITEventModePrimary   COLOEXITEventMode = "primary"
	COLOEXITEventModeSecondary COLOEXITEventMode = "secondary"
)

// COLOEXITEventReason is QAPI enum 451.
type COLOEXITEventReason string

const (
	COLOEXITEventReasonNone       COLOEXITEventReason = "none"
	COLOEXITEventReasonRequest    COLOEXITEventReason = "request"
	COLOEXITEventReasonError      COLOEXITEventReason = "error"
	COLOEXITEventReasonProcessing COLOEXITEventReason = "processing"
)

// CPUPOLARIZATIONCHANGEEventPolarization is QAPI enum 542.
type CPUPOLARIZATIONCHANGEEventPolarization string

const (
	CPUPOLARIZATIONCHANGEEventPolarizationHorizontal CPUPOLARIZATIONCHANGEEventPolarization = "horizontal"
	CPUPOLARIZATIONCHANGEEventPolarizationVertical   CPUPOLARIZATIONCHANGEEventPolarization = "vertical"
)

// CalcDirtyRateArgsCalcTimeUnit is QAPI enum 453.
type CalcDirtyRateArgsCalcTimeUnit string

const (
	CalcDirtyRateArgsCalcTimeUnitSecond      CalcDirtyRateArgsCalcTimeUnit = "second"
	CalcDirtyRateArgsCalcTimeUnitMillisecond CalcDirtyRateArgsCalcTimeUnit = "millisecond"
)

// CalcDirtyRateArgsMode is QAPI enum 454.
type CalcDirtyRateArgsMode string

const (
	CalcDirtyRateArgsModePageSampling CalcDirtyRateArgsMode = "page-sampling"
	CalcDirtyRateArgsModeDirtyRing    CalcDirtyRateArgsMode = "dirty-ring"
	CalcDirtyRateArgsModeDirtyBitmap  CalcDirtyRateArgsMode = "dirty-bitmap"
)

// ChardevAddArgsBackendDbusDataEncoding is QAPI enum 817.
type ChardevAddArgsBackendDbusDataEncoding string

const (
	ChardevAddArgsBackendDbusDataEncodingCp437 ChardevAddArgsBackendDbusDataEncoding = "cp437"
	ChardevAddArgsBackendDbusDataEncodingUtf8  ChardevAddArgsBackendDbusDataEncoding = "utf8"
)

// ChardevAddArgsBackendType_ is QAPI enum 644.
type ChardevAddArgsBackendType_ string

const (
	ChardevAddArgsBackendType_File        ChardevAddArgsBackendType_ = "file"
	ChardevAddArgsBackendType_Serial      ChardevAddArgsBackendType_ = "serial"
	ChardevAddArgsBackendType_Parallel    ChardevAddArgsBackendType_ = "parallel"
	ChardevAddArgsBackendType_Pipe        ChardevAddArgsBackendType_ = "pipe"
	ChardevAddArgsBackendType_Socket      ChardevAddArgsBackendType_ = "socket"
	ChardevAddArgsBackendType_Udp         ChardevAddArgsBackendType_ = "udp"
	ChardevAddArgsBackendType_Pty         ChardevAddArgsBackendType_ = "pty"
	ChardevAddArgsBackendType_Null        ChardevAddArgsBackendType_ = "null"
	ChardevAddArgsBackendType_Mux         ChardevAddArgsBackendType_ = "mux"
	ChardevAddArgsBackendType_Hub         ChardevAddArgsBackendType_ = "hub"
	ChardevAddArgsBackendType_Msmouse     ChardevAddArgsBackendType_ = "msmouse"
	ChardevAddArgsBackendType_Wctablet    ChardevAddArgsBackendType_ = "wctablet"
	ChardevAddArgsBackendType_Braille     ChardevAddArgsBackendType_ = "braille"
	ChardevAddArgsBackendType_Testdev     ChardevAddArgsBackendType_ = "testdev"
	ChardevAddArgsBackendType_Stdio       ChardevAddArgsBackendType_ = "stdio"
	ChardevAddArgsBackendType_Spicevmc    ChardevAddArgsBackendType_ = "spicevmc"
	ChardevAddArgsBackendType_Spiceport   ChardevAddArgsBackendType_ = "spiceport"
	ChardevAddArgsBackendType_QemuVdagent ChardevAddArgsBackendType_ = "qemu-vdagent"
	ChardevAddArgsBackendType_Dbus        ChardevAddArgsBackendType_ = "dbus"
	ChardevAddArgsBackendType_Vc          ChardevAddArgsBackendType_ = "vc"
	ChardevAddArgsBackendType_Ringbuf     ChardevAddArgsBackendType_ = "ringbuf"
	ChardevAddArgsBackendType_Memory      ChardevAddArgsBackendType_ = "memory"
)

// CxlAddDynamicCapacityArgsSelectionPolicy is QAPI enum 588.
type CxlAddDynamicCapacityArgsSelectionPolicy string

const (
	CxlAddDynamicCapacityArgsSelectionPolicyFree               CxlAddDynamicCapacityArgsSelectionPolicy = "free"
	CxlAddDynamicCapacityArgsSelectionPolicyContiguous         CxlAddDynamicCapacityArgsSelectionPolicy = "contiguous"
	CxlAddDynamicCapacityArgsSelectionPolicyPrescriptive       CxlAddDynamicCapacityArgsSelectionPolicy = "prescriptive"
	CxlAddDynamicCapacityArgsSelectionPolicyEnableSharedAccess CxlAddDynamicCapacityArgsSelectionPolicy = "enable-shared-access"
)

// CxlInjectCorrectableErrorArgsType_ is QAPI enum 587.
type CxlInjectCorrectableErrorArgsType_ string

const (
	CxlInjectCorrectableErrorArgsType_CacheDataEcc        CxlInjectCorrectableErrorArgsType_ = "cache-data-ecc"
	CxlInjectCorrectableErrorArgsType_MemDataEcc          CxlInjectCorrectableErrorArgsType_ = "mem-data-ecc"
	CxlInjectCorrectableErrorArgsType_CrcThreshold        CxlInjectCorrectableErrorArgsType_ = "crc-threshold"
	CxlInjectCorrectableErrorArgsType_RetryThreshold      CxlInjectCorrectableErrorArgsType_ = "retry-threshold"
	CxlInjectCorrectableErrorArgsType_CachePoisonReceived CxlInjectCorrectableErrorArgsType_ = "cache-poison-received"
	CxlInjectCorrectableErrorArgsType_MemPoisonReceived   CxlInjectCorrectableErrorArgsType_ = "mem-poison-received"
	CxlInjectCorrectableErrorArgsType_Physical            CxlInjectCorrectableErrorArgsType_ = "physical"
)

// CxlInjectGeneralMediaEventArgsLog is QAPI enum 585.
type CxlInjectGeneralMediaEventArgsLog string

const (
	CxlInjectGeneralMediaEventArgsLogInformational CxlInjectGeneralMediaEventArgsLog = "informational"
	CxlInjectGeneralMediaEventArgsLogWarning       CxlInjectGeneralMediaEventArgsLog = "warning"
	CxlInjectGeneralMediaEventArgsLogFailure       CxlInjectGeneralMediaEventArgsLog = "failure"
	CxlInjectGeneralMediaEventArgsLogFatal         CxlInjectGeneralMediaEventArgsLog = "fatal"
)

// CxlReleaseDynamicCapacityArgsRemovalPolicy is QAPI enum 590.
type CxlReleaseDynamicCapacityArgsRemovalPolicy string

const (
	CxlReleaseDynamicCapacityArgsRemovalPolicyTagBased     CxlReleaseDynamicCapacityArgsRemovalPolicy = "tag-based"
	CxlReleaseDynamicCapacityArgsRemovalPolicyPrescriptive CxlReleaseDynamicCapacityArgsRemovalPolicy = "prescriptive"
)

// DisplayReloadArgsType_ is QAPI enum 437.
type DisplayReloadArgsType_ string

const (
	DisplayReloadArgsType_Vnc DisplayReloadArgsType_ = "vnc"
)

// DisplayUpdateArgsType_ is QAPI enum 439.
type DisplayUpdateArgsType_ string

const (
	DisplayUpdateArgsType_Vnc DisplayUpdateArgsType_ = "vnc"
)

// DriveBackupArgsBitmapMode is QAPI enum 315.
type DriveBackupArgsBitmapMode string

const (
	DriveBackupArgsBitmapModeOnSuccess DriveBackupArgsBitmapMode = "on-success"
	DriveBackupArgsBitmapModeNever     DriveBackupArgsBitmapMode = "never"
	DriveBackupArgsBitmapModeAlways    DriveBackupArgsBitmapMode = "always"
)

// DriveBackupArgsOnCbwError is QAPI enum 316.
type DriveBackupArgsOnCbwError string

const (
	DriveBackupArgsOnCbwErrorBreakGuestWrite DriveBackupArgsOnCbwError = "break-guest-write"
	DriveBackupArgsOnCbwErrorBreakSnapshot   DriveBackupArgsOnCbwError = "break-snapshot"
)

// DriveBackupArgsSync is QAPI enum 314.
type DriveBackupArgsSync string

const (
	DriveBackupArgsSyncTop         DriveBackupArgsSync = "top"
	DriveBackupArgsSyncFull        DriveBackupArgsSync = "full"
	DriveBackupArgsSyncNone        DriveBackupArgsSync = "none"
	DriveBackupArgsSyncIncremental DriveBackupArgsSync = "incremental"
	DriveBackupArgsSyncBitmap      DriveBackupArgsSync = "bitmap"
)

// DriveMirrorArgsCopyMode is QAPI enum 325.
type DriveMirrorArgsCopyMode string

const (
	DriveMirrorArgsCopyModeBackground    DriveMirrorArgsCopyMode = "background"
	DriveMirrorArgsCopyModeWriteBlocking DriveMirrorArgsCopyMode = "write-blocking"
)

// DumpGuestMemoryArgsFormat is QAPI enum 381.
type DumpGuestMemoryArgsFormat string

const (
	DumpGuestMemoryArgsFormatElf            DumpGuestMemoryArgsFormat = "elf"
	DumpGuestMemoryArgsFormatKdumpZlib      DumpGuestMemoryArgsFormat = "kdump-zlib"
	DumpGuestMemoryArgsFormatKdumpLzo       DumpGuestMemoryArgsFormat = "kdump-lzo"
	DumpGuestMemoryArgsFormatKdumpSnappy    DumpGuestMemoryArgsFormat = "kdump-snappy"
	DumpGuestMemoryArgsFormatKdumpRawZlib   DumpGuestMemoryArgsFormat = "kdump-raw-zlib"
	DumpGuestMemoryArgsFormatKdumpRawLzo    DumpGuestMemoryArgsFormat = "kdump-raw-lzo"
	DumpGuestMemoryArgsFormatKdumpRawSnappy DumpGuestMemoryArgsFormat = "kdump-raw-snappy"
	DumpGuestMemoryArgsFormatWinDmp         DumpGuestMemoryArgsFormat = "win-dmp"
)

// GUESTPANICKEDEventAction is QAPI enum 299.
type GUESTPANICKEDEventAction string

const (
	GUESTPANICKEDEventActionPause    GUESTPANICKEDEventAction = "pause"
	GUESTPANICKEDEventActionPoweroff GUESTPANICKEDEventAction = "poweroff"
	GUESTPANICKEDEventActionRun      GUESTPANICKEDEventAction = "run"
)

// GUESTPANICKEDEventInfoS390Reason is QAPI enum 739.
type GUESTPANICKEDEventInfoS390Reason string

const (
	GUESTPANICKEDEventInfoS390ReasonUnknown      GUESTPANICKEDEventInfoS390Reason = "unknown"
	GUESTPANICKEDEventInfoS390ReasonDisabledWait GUESTPANICKEDEventInfoS390Reason = "disabled-wait"
	GUESTPANICKEDEventInfoS390ReasonExtintLoop   GUESTPANICKEDEventInfoS390Reason = "extint-loop"
	GUESTPANICKEDEventInfoS390ReasonPgmintLoop   GUESTPANICKEDEventInfoS390Reason = "pgmint-loop"
	GUESTPANICKEDEventInfoS390ReasonOpintLoop    GUESTPANICKEDEventInfoS390Reason = "opint-loop"
)

// GUESTPANICKEDEventInfoType_ is QAPI enum 591.
type GUESTPANICKEDEventInfoType_ string

const (
	GUESTPANICKEDEventInfoType_HyperV GUESTPANICKEDEventInfoType_ = "hyper-v"
	GUESTPANICKEDEventInfoType_S390   GUESTPANICKEDEventInfoType_ = "s390"
	GUESTPANICKEDEventInfoType_Tdx    GUESTPANICKEDEventInfoType_ = "tdx"
	GUESTPANICKEDEventInfoType_Sev    GUESTPANICKEDEventInfoType_ = "sev"
)

// ImageFormat is QAPI enum 415.
type ImageFormat string

const (
	ImageFormatPpm ImageFormat = "ppm"
	ImageFormatPng ImageFormat = "png"
)

// JOBSTATUSCHANGEEventStatus is QAPI enum 304.
type JOBSTATUSCHANGEEventStatus string

const (
	JOBSTATUSCHANGEEventStatusUndefined JOBSTATUSCHANGEEventStatus = "undefined"
	JOBSTATUSCHANGEEventStatusCreated   JOBSTATUSCHANGEEventStatus = "created"
	JOBSTATUSCHANGEEventStatusRunning   JOBSTATUSCHANGEEventStatus = "running"
	JOBSTATUSCHANGEEventStatusPaused    JOBSTATUSCHANGEEventStatus = "paused"
	JOBSTATUSCHANGEEventStatusReady     JOBSTATUSCHANGEEventStatus = "ready"
	JOBSTATUSCHANGEEventStatusStandby   JOBSTATUSCHANGEEventStatus = "standby"
	JOBSTATUSCHANGEEventStatusWaiting   JOBSTATUSCHANGEEventStatus = "waiting"
	JOBSTATUSCHANGEEventStatusPending   JOBSTATUSCHANGEEventStatus = "pending"
	JOBSTATUSCHANGEEventStatusAborting  JOBSTATUSCHANGEEventStatus = "aborting"
	JOBSTATUSCHANGEEventStatusConcluded JOBSTATUSCHANGEEventStatus = "concluded"
	JOBSTATUSCHANGEEventStatusNull      JOBSTATUSCHANGEEventStatus = "null"
)

// KeyValueKind is QAPI enum 672.
type KeyValueKind string

const (
	KeyValueKindNumber KeyValueKind = "number"
	KeyValueKindQcode  KeyValueKind = "qcode"
)

// MEMORYFAILUREEventAction is QAPI enum 302.
type MEMORYFAILUREEventAction string

const (
	MEMORYFAILUREEventActionIgnore MEMORYFAILUREEventAction = "ignore"
	MEMORYFAILUREEventActionInject MEMORYFAILUREEventAction = "inject"
	MEMORYFAILUREEventActionFatal  MEMORYFAILUREEventAction = "fatal"
	MEMORYFAILUREEventActionReset  MEMORYFAILUREEventAction = "reset"
)

// MEMORYFAILUREEventRecipient is QAPI enum 301.
type MEMORYFAILUREEventRecipient string

const (
	MEMORYFAILUREEventRecipientHypervisor MEMORYFAILUREEventRecipient = "hypervisor"
	MEMORYFAILUREEventRecipientGuest      MEMORYFAILUREEventRecipient = "guest"
)

// MigrateSetParametersArgsMode is QAPI enum 448.
type MigrateSetParametersArgsMode string

const (
	MigrateSetParametersArgsModeNormal      MigrateSetParametersArgsMode = "normal"
	MigrateSetParametersArgsModeCprReboot   MigrateSetParametersArgsMode = "cpr-reboot"
	MigrateSetParametersArgsModeCprTransfer MigrateSetParametersArgsMode = "cpr-transfer"
	MigrateSetParametersArgsModeCprExec     MigrateSetParametersArgsMode = "cpr-exec"
)

// MigrateSetParametersArgsMultifdCompression is QAPI enum 446.
type MigrateSetParametersArgsMultifdCompression string

const (
	MigrateSetParametersArgsMultifdCompressionNone MigrateSetParametersArgsMultifdCompression = "none"
	MigrateSetParametersArgsMultifdCompressionZlib MigrateSetParametersArgsMultifdCompression = "zlib"
	MigrateSetParametersArgsMultifdCompressionZstd MigrateSetParametersArgsMultifdCompression = "zstd"
)

// MigrateSetParametersArgsZeroPageDetection is QAPI enum 449.
type MigrateSetParametersArgsZeroPageDetection string

const (
	MigrateSetParametersArgsZeroPageDetectionNone    MigrateSetParametersArgsZeroPageDetection = "none"
	MigrateSetParametersArgsZeroPageDetectionLegacy  MigrateSetParametersArgsZeroPageDetection = "legacy"
	MigrateSetParametersArgsZeroPageDetectionMultifd MigrateSetParametersArgsZeroPageDetection = "multifd"
)

// NbdServerRemoveArgsMode is QAPI enum 372.
type NbdServerRemoveArgsMode string

const (
	NbdServerRemoveArgsModeSafe NbdServerRemoveArgsMode = "safe"
	NbdServerRemoveArgsModeHard NbdServerRemoveArgsMode = "hard"
)

// NbdServerStartArgsAddrType_ is QAPI enum 638.
type NbdServerStartArgsAddrType_ string

const (
	NbdServerStartArgsAddrType_Inet  NbdServerStartArgsAddrType_ = "inet"
	NbdServerStartArgsAddrType_Unix  NbdServerStartArgsAddrType_ = "unix"
	NbdServerStartArgsAddrType_Vsock NbdServerStartArgsAddrType_ = "vsock"
	NbdServerStartArgsAddrType_Fd    NbdServerStartArgsAddrType_ = "fd"
)

// NetdevAddArgsAfXdpMode is QAPI enum 666.
type NetdevAddArgsAfXdpMode string

const (
	NetdevAddArgsAfXdpModeNative NetdevAddArgsAfXdpMode = "native"
	NetdevAddArgsAfXdpModeSkb    NetdevAddArgsAfXdpMode = "skb"
)

// NetdevAddArgsType_ is QAPI enum 383.
type NetdevAddArgsType_ string

const (
	NetdevAddArgsType_None      NetdevAddArgsType_ = "none"
	NetdevAddArgsType_Nic       NetdevAddArgsType_ = "nic"
	NetdevAddArgsType_User      NetdevAddArgsType_ = "user"
	NetdevAddArgsType_Tap       NetdevAddArgsType_ = "tap"
	NetdevAddArgsType_L2tpv3    NetdevAddArgsType_ = "l2tpv3"
	NetdevAddArgsType_Socket    NetdevAddArgsType_ = "socket"
	NetdevAddArgsType_Stream    NetdevAddArgsType_ = "stream"
	NetdevAddArgsType_Dgram     NetdevAddArgsType_ = "dgram"
	NetdevAddArgsType_Vde       NetdevAddArgsType_ = "vde"
	NetdevAddArgsType_Bridge    NetdevAddArgsType_ = "bridge"
	NetdevAddArgsType_Hubport   NetdevAddArgsType_ = "hubport"
	NetdevAddArgsType_Netmap    NetdevAddArgsType_ = "netmap"
	NetdevAddArgsType_VhostUser NetdevAddArgsType_ = "vhost-user"
	NetdevAddArgsType_VhostVdpa NetdevAddArgsType_ = "vhost-vdpa"
	NetdevAddArgsType_Passt     NetdevAddArgsType_ = "passt"
	NetdevAddArgsType_AfXdp     NetdevAddArgsType_ = "af-xdp"
)

// ObjectAddArgsAuthzListPolicy is QAPI enum 700.
type ObjectAddArgsAuthzListPolicy string

const (
	ObjectAddArgsAuthzListPolicyDeny  ObjectAddArgsAuthzListPolicy = "deny"
	ObjectAddArgsAuthzListPolicyAllow ObjectAddArgsAuthzListPolicy = "allow"
)

// ObjectAddArgsFilterBufferInsert is QAPI enum 703.
type ObjectAddArgsFilterBufferInsert string

const (
	ObjectAddArgsFilterBufferInsertBefore ObjectAddArgsFilterBufferInsert = "before"
	ObjectAddArgsFilterBufferInsertBehind ObjectAddArgsFilterBufferInsert = "behind"
)

// ObjectAddArgsFilterBufferQueue is QAPI enum 702.
type ObjectAddArgsFilterBufferQueue string

const (
	ObjectAddArgsFilterBufferQueueAll ObjectAddArgsFilterBufferQueue = "all"
	ObjectAddArgsFilterBufferQueueRx  ObjectAddArgsFilterBufferQueue = "rx"
	ObjectAddArgsFilterBufferQueueTx  ObjectAddArgsFilterBufferQueue = "tx"
)

// ObjectAddArgsInputLinuxGrabToggle is QAPI enum 704.
type ObjectAddArgsInputLinuxGrabToggle string

const (
	ObjectAddArgsInputLinuxGrabToggleCtrlCtrl       ObjectAddArgsInputLinuxGrabToggle = "ctrl-ctrl"
	ObjectAddArgsInputLinuxGrabToggleAltAlt         ObjectAddArgsInputLinuxGrabToggle = "alt-alt"
	ObjectAddArgsInputLinuxGrabToggleShiftShift     ObjectAddArgsInputLinuxGrabToggle = "shift-shift"
	ObjectAddArgsInputLinuxGrabToggleMetaMeta       ObjectAddArgsInputLinuxGrabToggle = "meta-meta"
	ObjectAddArgsInputLinuxGrabToggleScrolllock     ObjectAddArgsInputLinuxGrabToggle = "scrolllock"
	ObjectAddArgsInputLinuxGrabToggleCtrlScrolllock ObjectAddArgsInputLinuxGrabToggle = "ctrl-scrolllock"
)

// ObjectAddArgsMemoryBackendEpcPolicy is QAPI enum 524.
type ObjectAddArgsMemoryBackendEpcPolicy string

const (
	ObjectAddArgsMemoryBackendEpcPolicyDefault_   ObjectAddArgsMemoryBackendEpcPolicy = "default"
	ObjectAddArgsMemoryBackendEpcPolicyPreferred  ObjectAddArgsMemoryBackendEpcPolicy = "preferred"
	ObjectAddArgsMemoryBackendEpcPolicyBind       ObjectAddArgsMemoryBackendEpcPolicy = "bind"
	ObjectAddArgsMemoryBackendEpcPolicyInterleave ObjectAddArgsMemoryBackendEpcPolicy = "interleave"
)

// ObjectAddArgsMonitorQmpCloseAction is QAPI enum 705.
type ObjectAddArgsMonitorQmpCloseAction string

const (
	ObjectAddArgsMonitorQmpCloseActionNone   ObjectAddArgsMonitorQmpCloseAction = "none"
	ObjectAddArgsMonitorQmpCloseActionDelete ObjectAddArgsMonitorQmpCloseAction = "delete"
)

// ObjectAddArgsQomType is QAPI enum 471.
type ObjectAddArgsQomType string

const (
	ObjectAddArgsQomTypeAcpiGenericInitiator    ObjectAddArgsQomType = "acpi-generic-initiator"
	ObjectAddArgsQomTypeAcpiGenericPort         ObjectAddArgsQomType = "acpi-generic-port"
	ObjectAddArgsQomTypeAuthzList               ObjectAddArgsQomType = "authz-list"
	ObjectAddArgsQomTypeAuthzListfile           ObjectAddArgsQomType = "authz-listfile"
	ObjectAddArgsQomTypeAuthzPam                ObjectAddArgsQomType = "authz-pam"
	ObjectAddArgsQomTypeAuthzSimple             ObjectAddArgsQomType = "authz-simple"
	ObjectAddArgsQomTypeCanBus                  ObjectAddArgsQomType = "can-bus"
	ObjectAddArgsQomTypeCanHostSocketcan        ObjectAddArgsQomType = "can-host-socketcan"
	ObjectAddArgsQomTypeColoCompare             ObjectAddArgsQomType = "colo-compare"
	ObjectAddArgsQomTypeCryptodevBackend        ObjectAddArgsQomType = "cryptodev-backend"
	ObjectAddArgsQomTypeCryptodevBackendBuiltin ObjectAddArgsQomType = "cryptodev-backend-builtin"
	ObjectAddArgsQomTypeCryptodevBackendLkcf    ObjectAddArgsQomType = "cryptodev-backend-lkcf"
	ObjectAddArgsQomTypeCryptodevVhostUser      ObjectAddArgsQomType = "cryptodev-vhost-user"
	ObjectAddArgsQomTypeDbusVmstate             ObjectAddArgsQomType = "dbus-vmstate"
	ObjectAddArgsQomTypeFilterBuffer            ObjectAddArgsQomType = "filter-buffer"
	ObjectAddArgsQomTypeFilterDump              ObjectAddArgsQomType = "filter-dump"
	ObjectAddArgsQomTypeFilterMirror            ObjectAddArgsQomType = "filter-mirror"
	ObjectAddArgsQomTypeFilterRedirector        ObjectAddArgsQomType = "filter-redirector"
	ObjectAddArgsQomTypeFilterReplay            ObjectAddArgsQomType = "filter-replay"
	ObjectAddArgsQomTypeFilterRewriter          ObjectAddArgsQomType = "filter-rewriter"
	ObjectAddArgsQomTypeInputBarrier            ObjectAddArgsQomType = "input-barrier"
	ObjectAddArgsQomTypeInputLinux              ObjectAddArgsQomType = "input-linux"
	ObjectAddArgsQomTypeIommufd                 ObjectAddArgsQomType = "iommufd"
	ObjectAddArgsQomTypeIothread                ObjectAddArgsQomType = "iothread"
	ObjectAddArgsQomTypeMainLoop                ObjectAddArgsQomType = "main-loop"
	ObjectAddArgsQomTypeMemoryBackendEpc        ObjectAddArgsQomType = "memory-backend-epc"
	ObjectAddArgsQomTypeMemoryBackendFile       ObjectAddArgsQomType = "memory-backend-file"
	ObjectAddArgsQomTypeMemoryBackendMemfd      ObjectAddArgsQomType = "memory-backend-memfd"
	ObjectAddArgsQomTypeMemoryBackendRam        ObjectAddArgsQomType = "memory-backend-ram"
	ObjectAddArgsQomTypeMemoryBackendShm        ObjectAddArgsQomType = "memory-backend-shm"
	ObjectAddArgsQomTypeMonitorHmp              ObjectAddArgsQomType = "monitor-hmp"
	ObjectAddArgsQomTypeMonitorQmp              ObjectAddArgsQomType = "monitor-qmp"
	ObjectAddArgsQomTypePefGuest                ObjectAddArgsQomType = "pef-guest"
	ObjectAddArgsQomTypePrManagerHelper         ObjectAddArgsQomType = "pr-manager-helper"
	ObjectAddArgsQomTypeQtest                   ObjectAddArgsQomType = "qtest"
	ObjectAddArgsQomTypeRngBuiltin              ObjectAddArgsQomType = "rng-builtin"
	ObjectAddArgsQomTypeRngEgd                  ObjectAddArgsQomType = "rng-egd"
	ObjectAddArgsQomTypeRngRandom               ObjectAddArgsQomType = "rng-random"
	ObjectAddArgsQomTypeSecret                  ObjectAddArgsQomType = "secret"
	ObjectAddArgsQomTypeSecretKeyring           ObjectAddArgsQomType = "secret_keyring"
	ObjectAddArgsQomTypeSevGuest                ObjectAddArgsQomType = "sev-guest"
	ObjectAddArgsQomTypeSevSnpGuest             ObjectAddArgsQomType = "sev-snp-guest"
	ObjectAddArgsQomTypeThreadContext           ObjectAddArgsQomType = "thread-context"
	ObjectAddArgsQomTypeS390PvGuest             ObjectAddArgsQomType = "s390-pv-guest"
	ObjectAddArgsQomTypeTdxGuest                ObjectAddArgsQomType = "tdx-guest"
	ObjectAddArgsQomTypeThrottleGroup           ObjectAddArgsQomType = "throttle-group"
	ObjectAddArgsQomTypeTlsCredsAnon            ObjectAddArgsQomType = "tls-creds-anon"
	ObjectAddArgsQomTypeTlsCredsPsk             ObjectAddArgsQomType = "tls-creds-psk"
	ObjectAddArgsQomTypeTlsCredsX509            ObjectAddArgsQomType = "tls-creds-x509"
	ObjectAddArgsQomTypeTlsCipherSuites         ObjectAddArgsQomType = "tls-cipher-suites"
	ObjectAddArgsQomTypeXRemoteObject           ObjectAddArgsQomType = "x-remote-object"
	ObjectAddArgsQomTypeXVfioUserServer         ObjectAddArgsQomType = "x-vfio-user-server"
)

// ObjectAddArgsSecretFormat is QAPI enum 706.
type ObjectAddArgsSecretFormat string

const (
	ObjectAddArgsSecretFormatRaw    ObjectAddArgsSecretFormat = "raw"
	ObjectAddArgsSecretFormatBase64 ObjectAddArgsSecretFormat = "base64"
)

// ObjectAddArgsTlsCredsAnonEndpoint is QAPI enum 708.
type ObjectAddArgsTlsCredsAnonEndpoint string

const (
	ObjectAddArgsTlsCredsAnonEndpointClient ObjectAddArgsTlsCredsAnonEndpoint = "client"
	ObjectAddArgsTlsCredsAnonEndpointServer ObjectAddArgsTlsCredsAnonEndpoint = "server"
)

// QKeyCode is QAPI enum 793.
type QKeyCode string

const (
	QKeyCodeUnmapped         QKeyCode = "unmapped"
	QKeyCodeShift            QKeyCode = "shift"
	QKeyCodeShiftR           QKeyCode = "shift_r"
	QKeyCodeAlt              QKeyCode = "alt"
	QKeyCodeAltR             QKeyCode = "alt_r"
	QKeyCodeCtrl             QKeyCode = "ctrl"
	QKeyCodeCtrlR            QKeyCode = "ctrl_r"
	QKeyCodeMenu             QKeyCode = "menu"
	QKeyCodeEsc              QKeyCode = "esc"
	QKeyCodeN1               QKeyCode = "1"
	QKeyCodeN2               QKeyCode = "2"
	QKeyCodeN3               QKeyCode = "3"
	QKeyCodeN4               QKeyCode = "4"
	QKeyCodeN5               QKeyCode = "5"
	QKeyCodeN6               QKeyCode = "6"
	QKeyCodeN7               QKeyCode = "7"
	QKeyCodeN8               QKeyCode = "8"
	QKeyCodeN9               QKeyCode = "9"
	QKeyCodeN0               QKeyCode = "0"
	QKeyCodeMinus            QKeyCode = "minus"
	QKeyCodeEqual            QKeyCode = "equal"
	QKeyCodeBackspace        QKeyCode = "backspace"
	QKeyCodeTab              QKeyCode = "tab"
	QKeyCodeQ                QKeyCode = "q"
	QKeyCodeW                QKeyCode = "w"
	QKeyCodeE                QKeyCode = "e"
	QKeyCodeR                QKeyCode = "r"
	QKeyCodeT                QKeyCode = "t"
	QKeyCodeY                QKeyCode = "y"
	QKeyCodeU                QKeyCode = "u"
	QKeyCodeI                QKeyCode = "i"
	QKeyCodeO                QKeyCode = "o"
	QKeyCodeP                QKeyCode = "p"
	QKeyCodeBracketLeft      QKeyCode = "bracket_left"
	QKeyCodeBracketRight     QKeyCode = "bracket_right"
	QKeyCodeRet              QKeyCode = "ret"
	QKeyCodeA                QKeyCode = "a"
	QKeyCodeS                QKeyCode = "s"
	QKeyCodeD                QKeyCode = "d"
	QKeyCodeF                QKeyCode = "f"
	QKeyCodeG                QKeyCode = "g"
	QKeyCodeH                QKeyCode = "h"
	QKeyCodeJ                QKeyCode = "j"
	QKeyCodeK                QKeyCode = "k"
	QKeyCodeL                QKeyCode = "l"
	QKeyCodeSemicolon        QKeyCode = "semicolon"
	QKeyCodeApostrophe       QKeyCode = "apostrophe"
	QKeyCodeGraveAccent      QKeyCode = "grave_accent"
	QKeyCodeBackslash        QKeyCode = "backslash"
	QKeyCodeZ                QKeyCode = "z"
	QKeyCodeX                QKeyCode = "x"
	QKeyCodeC                QKeyCode = "c"
	QKeyCodeV                QKeyCode = "v"
	QKeyCodeB                QKeyCode = "b"
	QKeyCodeN                QKeyCode = "n"
	QKeyCodeM                QKeyCode = "m"
	QKeyCodeComma            QKeyCode = "comma"
	QKeyCodeDot              QKeyCode = "dot"
	QKeyCodeSlash            QKeyCode = "slash"
	QKeyCodeAsterisk         QKeyCode = "asterisk"
	QKeyCodeSpc              QKeyCode = "spc"
	QKeyCodeCapsLock         QKeyCode = "caps_lock"
	QKeyCodeF1               QKeyCode = "f1"
	QKeyCodeF2               QKeyCode = "f2"
	QKeyCodeF3               QKeyCode = "f3"
	QKeyCodeF4               QKeyCode = "f4"
	QKeyCodeF5               QKeyCode = "f5"
	QKeyCodeF6               QKeyCode = "f6"
	QKeyCodeF7               QKeyCode = "f7"
	QKeyCodeF8               QKeyCode = "f8"
	QKeyCodeF9               QKeyCode = "f9"
	QKeyCodeF10              QKeyCode = "f10"
	QKeyCodeNumLock          QKeyCode = "num_lock"
	QKeyCodeScrollLock       QKeyCode = "scroll_lock"
	QKeyCodeKpDivide         QKeyCode = "kp_divide"
	QKeyCodeKpMultiply       QKeyCode = "kp_multiply"
	QKeyCodeKpSubtract       QKeyCode = "kp_subtract"
	QKeyCodeKpAdd            QKeyCode = "kp_add"
	QKeyCodeKpEnter          QKeyCode = "kp_enter"
	QKeyCodeKpDecimal        QKeyCode = "kp_decimal"
	QKeyCodeSysrq            QKeyCode = "sysrq"
	QKeyCodeKp0              QKeyCode = "kp_0"
	QKeyCodeKp1              QKeyCode = "kp_1"
	QKeyCodeKp2              QKeyCode = "kp_2"
	QKeyCodeKp3              QKeyCode = "kp_3"
	QKeyCodeKp4              QKeyCode = "kp_4"
	QKeyCodeKp5              QKeyCode = "kp_5"
	QKeyCodeKp6              QKeyCode = "kp_6"
	QKeyCodeKp7              QKeyCode = "kp_7"
	QKeyCodeKp8              QKeyCode = "kp_8"
	QKeyCodeKp9              QKeyCode = "kp_9"
	QKeyCodeLess             QKeyCode = "less"
	QKeyCodeF11              QKeyCode = "f11"
	QKeyCodeF12              QKeyCode = "f12"
	QKeyCodePrint            QKeyCode = "print"
	QKeyCodeHome             QKeyCode = "home"
	QKeyCodePgup             QKeyCode = "pgup"
	QKeyCodePgdn             QKeyCode = "pgdn"
	QKeyCodeEnd              QKeyCode = "end"
	QKeyCodeLeft             QKeyCode = "left"
	QKeyCodeUp               QKeyCode = "up"
	QKeyCodeDown             QKeyCode = "down"
	QKeyCodeRight            QKeyCode = "right"
	QKeyCodeInsert           QKeyCode = "insert"
	QKeyCodeDelete           QKeyCode = "delete"
	QKeyCodeStop             QKeyCode = "stop"
	QKeyCodeAgain            QKeyCode = "again"
	QKeyCodeProps            QKeyCode = "props"
	QKeyCodeUndo             QKeyCode = "undo"
	QKeyCodeFront            QKeyCode = "front"
	QKeyCodeCopy             QKeyCode = "copy"
	QKeyCodeOpen             QKeyCode = "open"
	QKeyCodePaste            QKeyCode = "paste"
	QKeyCodeFind             QKeyCode = "find"
	QKeyCodeCut              QKeyCode = "cut"
	QKeyCodeLf               QKeyCode = "lf"
	QKeyCodeHelp             QKeyCode = "help"
	QKeyCodeMetaL            QKeyCode = "meta_l"
	QKeyCodeMetaR            QKeyCode = "meta_r"
	QKeyCodeCompose          QKeyCode = "compose"
	QKeyCodePause            QKeyCode = "pause"
	QKeyCodeRo               QKeyCode = "ro"
	QKeyCodeHiragana         QKeyCode = "hiragana"
	QKeyCodeHenkan           QKeyCode = "henkan"
	QKeyCodeYen              QKeyCode = "yen"
	QKeyCodeMuhenkan         QKeyCode = "muhenkan"
	QKeyCodeKatakanahiragana QKeyCode = "katakanahiragana"
	QKeyCodeKpComma          QKeyCode = "kp_comma"
	QKeyCodeKpEquals         QKeyCode = "kp_equals"
	QKeyCodePower            QKeyCode = "power"
	QKeyCodeSleep            QKeyCode = "sleep"
	QKeyCodeWake             QKeyCode = "wake"
	QKeyCodeAudionext        QKeyCode = "audionext"
	QKeyCodeAudioprev        QKeyCode = "audioprev"
	QKeyCodeAudiostop        QKeyCode = "audiostop"
	QKeyCodeAudioplay        QKeyCode = "audioplay"
	QKeyCodeAudiomute        QKeyCode = "audiomute"
	QKeyCodeVolumeup         QKeyCode = "volumeup"
	QKeyCodeVolumedown       QKeyCode = "volumedown"
	QKeyCodeMediaselect      QKeyCode = "mediaselect"
	QKeyCodeMail             QKeyCode = "mail"
	QKeyCodeCalculator       QKeyCode = "calculator"
	QKeyCodeComputer         QKeyCode = "computer"
	QKeyCodeAcHome           QKeyCode = "ac_home"
	QKeyCodeAcBack           QKeyCode = "ac_back"
	QKeyCodeAcForward        QKeyCode = "ac_forward"
	QKeyCodeAcRefresh        QKeyCode = "ac_refresh"
	QKeyCodeAcBookmarks      QKeyCode = "ac_bookmarks"
	QKeyCodeLang1            QKeyCode = "lang1"
	QKeyCodeLang2            QKeyCode = "lang2"
	QKeyCodeF13              QKeyCode = "f13"
	QKeyCodeF14              QKeyCode = "f14"
	QKeyCodeF15              QKeyCode = "f15"
	QKeyCodeF16              QKeyCode = "f16"
	QKeyCodeF17              QKeyCode = "f17"
	QKeyCodeF18              QKeyCode = "f18"
	QKeyCodeF19              QKeyCode = "f19"
	QKeyCodeF20              QKeyCode = "f20"
	QKeyCodeF21              QKeyCode = "f21"
	QKeyCodeF22              QKeyCode = "f22"
	QKeyCodeF23              QKeyCode = "f23"
	QKeyCodeF24              QKeyCode = "f24"
)

// QMPCapability is QAPI enum 460.
type QMPCapability string

const (
	QMPCapabilityOob QMPCapability = "oob"
)

// QUORUMREPORTBADEventType_ is QAPI enum 370.
type QUORUMREPORTBADEventType_ string

const (
	QUORUMREPORTBADEventType_Read  QUORUMREPORTBADEventType_ = "read"
	QUORUMREPORTBADEventType_Write QUORUMREPORTBADEventType_ = "write"
	QUORUMREPORTBADEventType_Flush QUORUMREPORTBADEventType_ = "flush"
)

// QueryAcceleratorsResultEnabled is QAPI enum 306.
type QueryAcceleratorsResultEnabled string

const (
	QueryAcceleratorsResultEnabledHvf   QueryAcceleratorsResultEnabled = "hvf"
	QueryAcceleratorsResultEnabledKvm   QueryAcceleratorsResultEnabled = "kvm"
	QueryAcceleratorsResultEnabledMshv  QueryAcceleratorsResultEnabled = "mshv"
	QueryAcceleratorsResultEnabledNvmm  QueryAcceleratorsResultEnabled = "nvmm"
	QueryAcceleratorsResultEnabledQtest QueryAcceleratorsResultEnabled = "qtest"
	QueryAcceleratorsResultEnabledTcg   QueryAcceleratorsResultEnabled = "tcg"
	QueryAcceleratorsResultEnabledWhpx  QueryAcceleratorsResultEnabled = "whpx"
	QueryAcceleratorsResultEnabledXen   QueryAcceleratorsResultEnabled = "xen"
)

// QueryCpuModelComparisonResultResult is QAPI enum 539.
type QueryCpuModelComparisonResultResult string

const (
	QueryCpuModelComparisonResultResultIncompatible QueryCpuModelComparisonResultResult = "incompatible"
	QueryCpuModelComparisonResultResultIdentical    QueryCpuModelComparisonResultResult = "identical"
	QueryCpuModelComparisonResultResultSuperset     QueryCpuModelComparisonResultResult = "superset"
	QueryCpuModelComparisonResultResultSubset       QueryCpuModelComparisonResultResult = "subset"
)

// QueryCpuModelExpansionArgsType_ is QAPI enum 540.
type QueryCpuModelExpansionArgsType_ string

const (
	QueryCpuModelExpansionArgsType_Static QueryCpuModelExpansionArgsType_ = "static"
	QueryCpuModelExpansionArgsType_Full   QueryCpuModelExpansionArgsType_ = "full"
)

// QueryDirtyRateResultStatus is QAPI enum 455.
type QueryDirtyRateResultStatus string

const (
	QueryDirtyRateResultStatusUnstarted QueryDirtyRateResultStatus = "unstarted"
	QueryDirtyRateResultStatusMeasuring QueryDirtyRateResultStatus = "measuring"
	QueryDirtyRateResultStatusMeasured  QueryDirtyRateResultStatus = "measured"
)

// QueryDisplayOptionsResultGl is QAPI enum 430.
type QueryDisplayOptionsResultGl string

const (
	QueryDisplayOptionsResultGlOff  QueryDisplayOptionsResultGl = "off"
	QueryDisplayOptionsResultGlOn   QueryDisplayOptionsResultGl = "on"
	QueryDisplayOptionsResultGlCore QueryDisplayOptionsResultGl = "core"
	QueryDisplayOptionsResultGlEs   QueryDisplayOptionsResultGl = "es"
)

// QueryDisplayOptionsResultSdlGrabMod is QAPI enum 680.
type QueryDisplayOptionsResultSdlGrabMod string

const (
	QueryDisplayOptionsResultSdlGrabModLctrlLalt       QueryDisplayOptionsResultSdlGrabMod = "lctrl-lalt"
	QueryDisplayOptionsResultSdlGrabModLshiftLctrlLalt QueryDisplayOptionsResultSdlGrabMod = "lshift-lctrl-lalt"
	QueryDisplayOptionsResultSdlGrabModRctrl           QueryDisplayOptionsResultSdlGrabMod = "rctrl"
)

// QueryDisplayOptionsResultType_ is QAPI enum 429.
type QueryDisplayOptionsResultType_ string

const (
	QueryDisplayOptionsResultType_Default_    QueryDisplayOptionsResultType_ = "default"
	QueryDisplayOptionsResultType_None        QueryDisplayOptionsResultType_ = "none"
	QueryDisplayOptionsResultType_Gtk         QueryDisplayOptionsResultType_ = "gtk"
	QueryDisplayOptionsResultType_Sdl         QueryDisplayOptionsResultType_ = "sdl"
	QueryDisplayOptionsResultType_EglHeadless QueryDisplayOptionsResultType_ = "egl-headless"
	QueryDisplayOptionsResultType_Curses      QueryDisplayOptionsResultType_ = "curses"
	QueryDisplayOptionsResultType_SpiceApp    QueryDisplayOptionsResultType_ = "spice-app"
	QueryDisplayOptionsResultType_Dbus        QueryDisplayOptionsResultType_ = "dbus"
)

// QueryDumpResultStatus is QAPI enum 382.
type QueryDumpResultStatus string

const (
	QueryDumpResultStatusNone      QueryDumpResultStatus = "none"
	QueryDumpResultStatusActive    QueryDumpResultStatus = "active"
	QueryDumpResultStatusCompleted QueryDumpResultStatus = "completed"
	QueryDumpResultStatusFailed    QueryDumpResultStatus = "failed"
)

// QueryMigrateResultStatus is QAPI enum 441.
type QueryMigrateResultStatus string

const (
	QueryMigrateResultStatusNone                 QueryMigrateResultStatus = "none"
	QueryMigrateResultStatusSetup                QueryMigrateResultStatus = "setup"
	QueryMigrateResultStatusCancelling           QueryMigrateResultStatus = "cancelling"
	QueryMigrateResultStatusCancelled            QueryMigrateResultStatus = "cancelled"
	QueryMigrateResultStatusActive               QueryMigrateResultStatus = "active"
	QueryMigrateResultStatusPostcopyDevice       QueryMigrateResultStatus = "postcopy-device"
	QueryMigrateResultStatusPostcopyActive       QueryMigrateResultStatus = "postcopy-active"
	QueryMigrateResultStatusPostcopyPaused       QueryMigrateResultStatus = "postcopy-paused"
	QueryMigrateResultStatusPostcopyRecoverSetup QueryMigrateResultStatus = "postcopy-recover-setup"
	QueryMigrateResultStatusPostcopyRecover      QueryMigrateResultStatus = "postcopy-recover"
	QueryMigrateResultStatusCompleted            QueryMigrateResultStatus = "completed"
	QueryMigrateResultStatusFailing              QueryMigrateResultStatus = "failing"
	QueryMigrateResultStatusFailed               QueryMigrateResultStatus = "failed"
	QueryMigrateResultStatusColo                 QueryMigrateResultStatus = "colo"
	QueryMigrateResultStatusPreSwitchover        QueryMigrateResultStatus = "pre-switchover"
	QueryMigrateResultStatusDevice               QueryMigrateResultStatus = "device"
	QueryMigrateResultStatusWaitUnplug           QueryMigrateResultStatus = "wait-unplug"
)

// QueryReplayResultMode is QAPI enum 543.
type QueryReplayResultMode string

const (
	QueryReplayResultModeNone   QueryReplayResultMode = "none"
	QueryReplayResultModeRecord QueryReplayResultMode = "record"
	QueryReplayResultModePlay   QueryReplayResultMode = "play"
)

// QuerySevResultSevType is QAPI enum 550.
type QuerySevResultSevType string

const (
	QuerySevResultSevTypeSev    QuerySevResultSevType = "sev"
	QuerySevResultSevTypeSevSnp QuerySevResultSevType = "sev-snp"
)

// QuerySevResultState is QAPI enum 549.
type QuerySevResultState string

const (
	QuerySevResultStateUninit        QuerySevResultState = "uninit"
	QuerySevResultStateLaunchUpdate  QuerySevResultState = "launch-update"
	QuerySevResultStateLaunchSecret  QuerySevResultState = "launch-secret"
	QuerySevResultStateRunning       QuerySevResultState = "running"
	QuerySevResultStateSendUpdate    QuerySevResultState = "send-update"
	QuerySevResultStateReceiveUpdate QuerySevResultState = "receive-update"
)

// QuerySpiceResultMouseMode is QAPI enum 416.
type QuerySpiceResultMouseMode string

const (
	QuerySpiceResultMouseModeClient  QuerySpiceResultMouseMode = "client"
	QuerySpiceResultMouseModeServer  QuerySpiceResultMouseMode = "server"
	QuerySpiceResultMouseModeUnknown QuerySpiceResultMouseMode = "unknown"
)

// QueryStatsArgsTarget is QAPI enum 570.
type QueryStatsArgsTarget string

const (
	QueryStatsArgsTargetVm        QueryStatsArgsTarget = "vm"
	QueryStatsArgsTargetVcpu      QueryStatsArgsTarget = "vcpu"
	QueryStatsArgsTargetCryptodev QueryStatsArgsTarget = "cryptodev"
)

// QueryStatsSchemasArgsProvider is QAPI enum 573.
type QueryStatsSchemasArgsProvider string

const (
	QueryStatsSchemasArgsProviderKvm       QueryStatsSchemasArgsProvider = "kvm"
	QueryStatsSchemasArgsProviderCryptodev QueryStatsSchemasArgsProvider = "cryptodev"
)

// QueryStatusResultStatus is QAPI enum 293.
type QueryStatusResultStatus string

const (
	QueryStatusResultStatusDebug         QueryStatusResultStatus = "debug"
	QueryStatusResultStatusInmigrate     QueryStatusResultStatus = "inmigrate"
	QueryStatusResultStatusInternalError QueryStatusResultStatus = "internal-error"
	QueryStatusResultStatusIoError       QueryStatusResultStatus = "io-error"
	QueryStatusResultStatusPaused        QueryStatusResultStatus = "paused"
	QueryStatusResultStatusPostmigrate   QueryStatusResultStatus = "postmigrate"
	QueryStatusResultStatusPrelaunch     QueryStatusResultStatus = "prelaunch"
	QueryStatusResultStatusFinishMigrate QueryStatusResultStatus = "finish-migrate"
	QueryStatusResultStatusRestoreVm     QueryStatusResultStatus = "restore-vm"
	QueryStatusResultStatusRunning       QueryStatusResultStatus = "running"
	QueryStatusResultStatusSaveVm        QueryStatusResultStatus = "save-vm"
	QueryStatusResultStatusShutdown      QueryStatusResultStatus = "shutdown"
	QueryStatusResultStatusSuspended     QueryStatusResultStatus = "suspended"
	QueryStatusResultStatusWatchdog      QueryStatusResultStatus = "watchdog"
	QueryStatusResultStatusGuestPanicked QueryStatusResultStatus = "guest-panicked"
	QueryStatusResultStatusColo          QueryStatusResultStatus = "colo"
)

// QueryTargetResultArch is QAPI enum 521.
type QueryTargetResultArch string

const (
	QueryTargetResultArchAarch64     QueryTargetResultArch = "aarch64"
	QueryTargetResultArchAlpha       QueryTargetResultArch = "alpha"
	QueryTargetResultArchArm         QueryTargetResultArch = "arm"
	QueryTargetResultArchAvr         QueryTargetResultArch = "avr"
	QueryTargetResultArchHexagon     QueryTargetResultArch = "hexagon"
	QueryTargetResultArchHppa        QueryTargetResultArch = "hppa"
	QueryTargetResultArchI386        QueryTargetResultArch = "i386"
	QueryTargetResultArchLoongarch64 QueryTargetResultArch = "loongarch64"
	QueryTargetResultArchM68k        QueryTargetResultArch = "m68k"
	QueryTargetResultArchMicroblaze  QueryTargetResultArch = "microblaze"
	QueryTargetResultArchMips        QueryTargetResultArch = "mips"
	QueryTargetResultArchMips64      QueryTargetResultArch = "mips64"
	QueryTargetResultArchMips64el    QueryTargetResultArch = "mips64el"
	QueryTargetResultArchMipsel      QueryTargetResultArch = "mipsel"
	QueryTargetResultArchOr1k        QueryTargetResultArch = "or1k"
	QueryTargetResultArchPpc         QueryTargetResultArch = "ppc"
	QueryTargetResultArchPpc64       QueryTargetResultArch = "ppc64"
	QueryTargetResultArchRiscv32     QueryTargetResultArch = "riscv32"
	QueryTargetResultArchRiscv64     QueryTargetResultArch = "riscv64"
	QueryTargetResultArchRx          QueryTargetResultArch = "rx"
	QueryTargetResultArchS390x       QueryTargetResultArch = "s390x"
	QueryTargetResultArchSh4         QueryTargetResultArch = "sh4"
	QueryTargetResultArchSh4eb       QueryTargetResultArch = "sh4eb"
	QueryTargetResultArchSparc       QueryTargetResultArch = "sparc"
	QueryTargetResultArchSparc64     QueryTargetResultArch = "sparc64"
	QueryTargetResultArchTricore     QueryTargetResultArch = "tricore"
	QueryTargetResultArchX8664       QueryTargetResultArch = "x86_64"
	QueryTargetResultArchXtensa      QueryTargetResultArch = "xtensa"
	QueryTargetResultArchXtensaeb    QueryTargetResultArch = "xtensaeb"
)

// QueryVncResultFamily is QAPI enum 420.
type QueryVncResultFamily string

const (
	QueryVncResultFamilyIpv4    QueryVncResultFamily = "ipv4"
	QueryVncResultFamilyIpv6    QueryVncResultFamily = "ipv6"
	QueryVncResultFamilyUnix    QueryVncResultFamily = "unix"
	QueryVncResultFamilyVsock   QueryVncResultFamily = "vsock"
	QueryVncResultFamilyUnknown QueryVncResultFamily = "unknown"
)

// RequestEbpfArgsId is QAPI enum 404.
type RequestEbpfArgsId string

const (
	RequestEbpfArgsIdRss RequestEbpfArgsId = "rss"
)

// RingbufWriteArgsFormat is QAPI enum 379.
type RingbufWriteArgsFormat string

const (
	RingbufWriteArgsFormatUtf8   RingbufWriteArgsFormat = "utf8"
	RingbufWriteArgsFormatBase64 RingbufWriteArgsFormat = "base64"
)

// SHUTDOWNEventReason is QAPI enum 294.
type SHUTDOWNEventReason string

const (
	SHUTDOWNEventReasonNone               SHUTDOWNEventReason = "none"
	SHUTDOWNEventReasonHostError          SHUTDOWNEventReason = "host-error"
	SHUTDOWNEventReasonHostQmpQuit        SHUTDOWNEventReason = "host-qmp-quit"
	SHUTDOWNEventReasonHostQmpSystemReset SHUTDOWNEventReason = "host-qmp-system-reset"
	SHUTDOWNEventReasonHostSignal         SHUTDOWNEventReason = "host-signal"
	SHUTDOWNEventReasonHostUi             SHUTDOWNEventReason = "host-ui"
	SHUTDOWNEventReasonGuestShutdown      SHUTDOWNEventReason = "guest-shutdown"
	SHUTDOWNEventReasonGuestReset         SHUTDOWNEventReason = "guest-reset"
	SHUTDOWNEventReasonGuestPanic         SHUTDOWNEventReason = "guest-panic"
	SHUTDOWNEventReasonSubsystemReset     SHUTDOWNEventReason = "subsystem-reset"
	SHUTDOWNEventReasonSnapshotLoad       SHUTDOWNEventReason = "snapshot-load"
)

// SetActionArgsPanic is QAPI enum 298.
type SetActionArgsPanic string

const (
	SetActionArgsPanicPause       SetActionArgsPanic = "pause"
	SetActionArgsPanicShutdown    SetActionArgsPanic = "shutdown"
	SetActionArgsPanicExitFailure SetActionArgsPanic = "exit-failure"
	SetActionArgsPanicNone        SetActionArgsPanic = "none"
)

// SetActionArgsReboot is QAPI enum 296.
type SetActionArgsReboot string

const (
	SetActionArgsRebootReset    SetActionArgsReboot = "reset"
	SetActionArgsRebootShutdown SetActionArgsReboot = "shutdown"
)

// SetActionArgsShutdown is QAPI enum 297.
type SetActionArgsShutdown string

const (
	SetActionArgsShutdownPoweroff SetActionArgsShutdown = "poweroff"
	SetActionArgsShutdownPause    SetActionArgsShutdown = "pause"
)

// SetCpuTopologyArgsEntitlement is QAPI enum 541.
type SetCpuTopologyArgsEntitlement string

const (
	SetCpuTopologyArgsEntitlementAuto   SetCpuTopologyArgsEntitlement = "auto"
	SetCpuTopologyArgsEntitlementLow    SetCpuTopologyArgsEntitlement = "low"
	SetCpuTopologyArgsEntitlementMedium SetCpuTopologyArgsEntitlement = "medium"
	SetCpuTopologyArgsEntitlementHigh   SetCpuTopologyArgsEntitlement = "high"
)

// SetNumaNodeArgsHmatCacheAssociativity is QAPI enum 712.
type SetNumaNodeArgsHmatCacheAssociativity string

const (
	SetNumaNodeArgsHmatCacheAssociativityNone    SetNumaNodeArgsHmatCacheAssociativity = "none"
	SetNumaNodeArgsHmatCacheAssociativityDirect  SetNumaNodeArgsHmatCacheAssociativity = "direct"
	SetNumaNodeArgsHmatCacheAssociativityComplex SetNumaNodeArgsHmatCacheAssociativity = "complex"
)

// SetNumaNodeArgsHmatCachePolicy is QAPI enum 713.
type SetNumaNodeArgsHmatCachePolicy string

const (
	SetNumaNodeArgsHmatCachePolicyNone         SetNumaNodeArgsHmatCachePolicy = "none"
	SetNumaNodeArgsHmatCachePolicyWriteBack    SetNumaNodeArgsHmatCachePolicy = "write-back"
	SetNumaNodeArgsHmatCachePolicyWriteThrough SetNumaNodeArgsHmatCachePolicy = "write-through"
)

// SetNumaNodeArgsHmatLbDataType is QAPI enum 711.
type SetNumaNodeArgsHmatLbDataType string

const (
	SetNumaNodeArgsHmatLbDataTypeAccessLatency   SetNumaNodeArgsHmatLbDataType = "access-latency"
	SetNumaNodeArgsHmatLbDataTypeReadLatency     SetNumaNodeArgsHmatLbDataType = "read-latency"
	SetNumaNodeArgsHmatLbDataTypeWriteLatency    SetNumaNodeArgsHmatLbDataType = "write-latency"
	SetNumaNodeArgsHmatLbDataTypeAccessBandwidth SetNumaNodeArgsHmatLbDataType = "access-bandwidth"
	SetNumaNodeArgsHmatLbDataTypeReadBandwidth   SetNumaNodeArgsHmatLbDataType = "read-bandwidth"
	SetNumaNodeArgsHmatLbDataTypeWriteBandwidth  SetNumaNodeArgsHmatLbDataType = "write-bandwidth"
)

// SetNumaNodeArgsHmatLbHierarchy is QAPI enum 710.
type SetNumaNodeArgsHmatLbHierarchy string

const (
	SetNumaNodeArgsHmatLbHierarchyMemory      SetNumaNodeArgsHmatLbHierarchy = "memory"
	SetNumaNodeArgsHmatLbHierarchyFirstLevel  SetNumaNodeArgsHmatLbHierarchy = "first-level"
	SetNumaNodeArgsHmatLbHierarchySecondLevel SetNumaNodeArgsHmatLbHierarchy = "second-level"
	SetNumaNodeArgsHmatLbHierarchyThirdLevel  SetNumaNodeArgsHmatLbHierarchy = "third-level"
)

// SetNumaNodeArgsType_ is QAPI enum 525.
type SetNumaNodeArgsType_ string

const (
	SetNumaNodeArgsType_Node      SetNumaNodeArgsType_ = "node"
	SetNumaNodeArgsType_Dist      SetNumaNodeArgsType_ = "dist"
	SetNumaNodeArgsType_Cpu       SetNumaNodeArgsType_ = "cpu"
	SetNumaNodeArgsType_HmatLb    SetNumaNodeArgsType_ = "hmat-lb"
	SetNumaNodeArgsType_HmatCache SetNumaNodeArgsType_ = "hmat-cache"
)

// SetPasswordArgsConnected is QAPI enum 412.
type SetPasswordArgsConnected string

const (
	SetPasswordArgsConnectedKeep       SetPasswordArgsConnected = "keep"
	SetPasswordArgsConnectedFail       SetPasswordArgsConnected = "fail"
	SetPasswordArgsConnectedDisconnect SetPasswordArgsConnected = "disconnect"
)

// SetPasswordArgsProtocol is QAPI enum 411.
type SetPasswordArgsProtocol string

const (
	SetPasswordArgsProtocolVnc   SetPasswordArgsProtocol = "vnc"
	SetPasswordArgsProtocolSpice SetPasswordArgsProtocol = "spice"
)

// TransactionArgsPropertiesCompletionMode is QAPI enum 694.
type TransactionArgsPropertiesCompletionMode string

const (
	TransactionArgsPropertiesCompletionModeIndividual TransactionArgsPropertiesCompletionMode = "individual"
	TransactionArgsPropertiesCompletionModeGrouped    TransactionArgsPropertiesCompletionMode = "grouped"
)

// TypeN127 is QAPI enum 127.
type TypeN127 string

const (
	TypeN127TpmTis   TypeN127 = "tpm-tis"
	TypeN127TpmCrb   TypeN127 = "tpm-crb"
	TypeN127TpmSpapr TypeN127 = "tpm-spapr"
)

// TypeN128 is QAPI enum 128.
type TypeN128 string

const (
	TypeN128Passthrough TypeN128 = "passthrough"
	TypeN128Emulator    TypeN128 = "emulator"
)

// TypeN308 is QAPI enum 308.
type TypeN308 string

const (
	TypeN308Ok      TypeN308 = "ok"
	TypeN308Failed  TypeN308 = "failed"
	TypeN308Nospace TypeN308 = "nospace"
)

// TypeN402 is QAPI enum 402.
type TypeN402 string

const (
	TypeN402Normal TypeN402 = "normal"
	TypeN402None   TypeN402 = "none"
	TypeN402All    TypeN402 = "all"
)

// TypeN405 is QAPI enum 405.
type TypeN405 string

const (
	TypeN405Half TypeN405 = "half"
	TypeN405Full TypeN405 = "full"
)

// TypeN406 is QAPI enum 406.
type TypeN406 string

const (
	TypeN406Off TypeN406 = "off"
	TypeN406On  TypeN406 = "on"
)

// TypeN423 is QAPI enum 423.
type TypeN423 string

const (
	TypeN423None     TypeN423 = "none"
	TypeN423Vnc      TypeN423 = "vnc"
	TypeN423Ra2      TypeN423 = "ra2"
	TypeN423Ra2ne    TypeN423 = "ra2ne"
	TypeN423Tight    TypeN423 = "tight"
	TypeN423Ultra    TypeN423 = "ultra"
	TypeN423Tls      TypeN423 = "tls"
	TypeN423Vencrypt TypeN423 = "vencrypt"
	TypeN423Sasl     TypeN423 = "sasl"
)

// TypeN424 is QAPI enum 424.
type TypeN424 string

const (
	TypeN424Plain     TypeN424 = "plain"
	TypeN424TlsNone   TypeN424 = "tls-none"
	TypeN424X509None  TypeN424 = "x509-none"
	TypeN424TlsVnc    TypeN424 = "tls-vnc"
	TypeN424X509Vnc   TypeN424 = "x509-vnc"
	TypeN424TlsPlain  TypeN424 = "tls-plain"
	TypeN424X509Plain TypeN424 = "x509-plain"
	TypeN424TlsSasl   TypeN424 = "tls-sasl"
	TypeN424X509Sasl  TypeN424 = "x509-sasl"
)

// TypeN445 is QAPI enum 445.
type TypeN445 string

const (
	TypeN445Xbzrle                TypeN445 = "xbzrle"
	TypeN445RdmaPinAll            TypeN445 = "rdma-pin-all"
	TypeN445AutoConverge          TypeN445 = "auto-converge"
	TypeN445Events                TypeN445 = "events"
	TypeN445PostcopyRam           TypeN445 = "postcopy-ram"
	TypeN445XColo                 TypeN445 = "x-colo"
	TypeN445ReleaseRam            TypeN445 = "release-ram"
	TypeN445ReturnPath            TypeN445 = "return-path"
	TypeN445PauseBeforeSwitchover TypeN445 = "pause-before-switchover"
	TypeN445Multifd               TypeN445 = "multifd"
	TypeN445DirtyBitmaps          TypeN445 = "dirty-bitmaps"
	TypeN445PostcopyBlocktime     TypeN445 = "postcopy-blocktime"
	TypeN445LateBlockActivate     TypeN445 = "late-block-activate"
	TypeN445XIgnoreShared         TypeN445 = "x-ignore-shared"
	TypeN445ValidateUuid          TypeN445 = "validate-uuid"
	TypeN445BackgroundSnapshot    TypeN445 = "background-snapshot"
	TypeN445ZeroCopySend          TypeN445 = "zero-copy-send"
	TypeN445PostcopyPreempt       TypeN445 = "postcopy-preempt"
	TypeN445SwitchoverAck         TypeN445 = "switchover-ack"
	TypeN445DirtyLimit            TypeN445 = "dirty-limit"
	TypeN445MappedRam             TypeN445 = "mapped-ram"
)

// TypeN459 is QAPI enum 459.
type TypeN459 string

const (
	TypeN459Unavailable TypeN459 = "unavailable"
	TypeN459Disabled    TypeN459 = "disabled"
	TypeN459Enabled     TypeN459 = "enabled"
)

// TypeN462 is QAPI enum 462.
type TypeN462 string

const (
	TypeN462Builtin   TypeN462 = "builtin"
	TypeN462Enum      TypeN462 = "enum"
	TypeN462Array     TypeN462 = "array"
	TypeN462Object    TypeN462 = "object"
	TypeN462Alternate TypeN462 = "alternate"
	TypeN462Command   TypeN462 = "command"
	TypeN462Event     TypeN462 = "event"
)

// TypeN531 is QAPI enum 531.
type TypeN531 string

const (
	TypeN531Dimm       TypeN531 = "dimm"
	TypeN531Nvdimm     TypeN531 = "nvdimm"
	TypeN531VirtioPmem TypeN531 = "virtio-pmem"
	TypeN531VirtioMem  TypeN531 = "virtio-mem"
	TypeN531SgxEpc     TypeN531 = "sgx-epc"
	TypeN531HvBalloon  TypeN531 = "hv-balloon"
	TypeN531SpMem      TypeN531 = "sp-mem"
)

// TypeN544 is QAPI enum 544.
type TypeN544 string

const (
	TypeN544BlockNode TypeN544 = "block-node"
	TypeN544Chardev   TypeN544 = "chardev"
	TypeN544Migration TypeN544 = "migration"
)

// TypeN554 is QAPI enum 554.
type TypeN554 string

const (
	TypeN554Closed      TypeN554 = "closed"
	TypeN554Unbound     TypeN554 = "unbound"
	TypeN554Interdomain TypeN554 = "interdomain"
	TypeN554Pirq        TypeN554 = "pirq"
	TypeN554Virq        TypeN554 = "virq"
	TypeN554Ipi         TypeN554 = "ipi"
)

// TypeN555 is QAPI enum 555.
type TypeN555 string

const (
	TypeN555None     TypeN555 = "none"
	TypeN555Alsa     TypeN555 = "alsa"
	TypeN555Dbus     TypeN555 = "dbus"
	TypeN555Jack     TypeN555 = "jack"
	TypeN555Oss      TypeN555 = "oss"
	TypeN555Pa       TypeN555 = "pa"
	TypeN555Pipewire TypeN555 = "pipewire"
	TypeN555Sdl      TypeN555 = "sdl"
	TypeN555Spice    TypeN555 = "spice"
	TypeN555Wav      TypeN555 = "wav"
)

// TypeN583 is QAPI enum 583.
type TypeN583 string

const (
	TypeN583Cipher   TypeN583 = "cipher"
	TypeN583Hash     TypeN583 = "hash"
	TypeN583Mac      TypeN583 = "mac"
	TypeN583Aead     TypeN583 = "aead"
	TypeN583Akcipher TypeN583 = "akcipher"
)

// TypeN602 is QAPI enum 602.
type TypeN602 string

const (
	TypeN602BlockBackend TypeN602 = "block-backend"
	TypeN602BlockJob     TypeN602 = "block-job"
	TypeN602BlockDriver  TypeN602 = "block-driver"
)

// TypeN603 is QAPI enum 603.
type TypeN603 string

const (
	TypeN603ConsistentRead TypeN603 = "consistent-read"
	TypeN603Write          TypeN603 = "write"
	TypeN603WriteUnchanged TypeN603 = "write-unchanged"
	TypeN603Resize         TypeN603 = "resize"
)

// TypeN618 is QAPI enum 618.
type TypeN618 string

const (
	TypeN618Cephx TypeN618 = "cephx"
	TypeN618None  TypeN618 = "none"
)

// TypeN675 is QAPI enum 675.
type TypeN675 string

const (
	TypeN675Key TypeN675 = "key"
	TypeN675Btn TypeN675 = "btn"
	TypeN675Rel TypeN675 = "rel"
	TypeN675Abs TypeN675 = "abs"
	TypeN675Mtt TypeN675 = "mtt"
)

// TypeN682 is QAPI enum 682.
type TypeN682 string

const (
	TypeN682Main TypeN682 = "main"
	TypeN682Cpr  TypeN682 = "cpr"
)

// TypeN684 is QAPI enum 684.
type TypeN684 string

const (
	TypeN684Abort                        TypeN684 = "abort"
	TypeN684BlockDirtyBitmapAdd          TypeN684 = "block-dirty-bitmap-add"
	TypeN684BlockDirtyBitmapRemove       TypeN684 = "block-dirty-bitmap-remove"
	TypeN684BlockDirtyBitmapClear        TypeN684 = "block-dirty-bitmap-clear"
	TypeN684BlockDirtyBitmapEnable       TypeN684 = "block-dirty-bitmap-enable"
	TypeN684BlockDirtyBitmapDisable      TypeN684 = "block-dirty-bitmap-disable"
	TypeN684BlockDirtyBitmapMerge        TypeN684 = "block-dirty-bitmap-merge"
	TypeN684BlockdevBackup               TypeN684 = "blockdev-backup"
	TypeN684BlockdevSnapshot             TypeN684 = "blockdev-snapshot"
	TypeN684BlockdevSnapshotInternalSync TypeN684 = "blockdev-snapshot-internal-sync"
	TypeN684BlockdevSnapshotSync         TypeN684 = "blockdev-snapshot-sync"
	TypeN684DriveBackup                  TypeN684 = "drive-backup"
)

// TypeN695 is QAPI enum 695.
type TypeN695 string

const (
	TypeN695String  TypeN695 = "string"
	TypeN695Number  TypeN695 = "number"
	TypeN695Int     TypeN695 = "int"
	TypeN695Boolean TypeN695 = "boolean"
	TypeN695Null    TypeN695 = "null"
	TypeN695Object  TypeN695 = "object"
	TypeN695Array   TypeN695 = "array"
	TypeN695Value   TypeN695 = "value"
)

// TypeN709 is QAPI enum 709.
type TypeN709 string

const (
	TypeN709Uninitialized TypeN709 = "uninitialized"
	TypeN709Stopped       TypeN709 = "stopped"
	TypeN709CheckStop     TypeN709 = "check-stop"
	TypeN709Operating     TypeN709 = "operating"
	TypeN709Load          TypeN709 = "load"
)

// TypeN720 is QAPI enum 720.
type TypeN720 string

const (
	TypeN720String  TypeN720 = "string"
	TypeN720Boolean TypeN720 = "boolean"
	TypeN720Number  TypeN720 = "number"
	TypeN720Size    TypeN720 = "size"
)

// TypeN734 is QAPI enum 734.
type TypeN734 string

const (
	TypeN734Cumulative      TypeN734 = "cumulative"
	TypeN734Instant         TypeN734 = "instant"
	TypeN734Peak            TypeN734 = "peak"
	TypeN734LinearHistogram TypeN734 = "linear-histogram"
	TypeN734Log2Histogram   TypeN734 = "log2-histogram"
)

// TypeN735 is QAPI enum 735.
type TypeN735 string

const (
	TypeN735Bytes   TypeN735 = "bytes"
	TypeN735Seconds TypeN735 = "seconds"
	TypeN735Cycles  TypeN735 = "cycles"
	TypeN735Boolean TypeN735 = "boolean"
)

// TypeN737 is QAPI enum 737.
type TypeN737 string

const (
	TypeN737Builtin   TypeN737 = "builtin"
	TypeN737VhostUser TypeN737 = "vhost-user"
	TypeN737Lkcf      TypeN737 = "lkcf"
)

// TypeN738 is QAPI enum 738.
type TypeN738 string

const (
	TypeN738CacheDataParity    TypeN738 = "cache-data-parity"
	TypeN738CacheAddressParity TypeN738 = "cache-address-parity"
	TypeN738CacheBeParity      TypeN738 = "cache-be-parity"
	TypeN738CacheDataEcc       TypeN738 = "cache-data-ecc"
	TypeN738MemDataParity      TypeN738 = "mem-data-parity"
	TypeN738MemAddressParity   TypeN738 = "mem-address-parity"
	TypeN738MemBeParity        TypeN738 = "mem-be-parity"
	TypeN738MemDataEcc         TypeN738 = "mem-data-ecc"
	TypeN738ReinitThreshold    TypeN738 = "reinit-threshold"
	TypeN738RsvdEncoding       TypeN738 = "rsvd-encoding"
	TypeN738PoisonReceived     TypeN738 = "poison-received"
	TypeN738ReceiverOverflow   TypeN738 = "receiver-overflow"
	TypeN738Internal           TypeN738 = "internal"
	TypeN738CxlIdeTx           TypeN738 = "cxl-ide-tx"
	TypeN738CxlIdeRx           TypeN738 = "cxl-ide-rx"
)

// TypeN740 is QAPI enum 740.
type TypeN740 string

const (
	TypeN740Qcow2 TypeN740 = "qcow2"
	TypeN740Vmdk  TypeN740 = "vmdk"
	TypeN740Luks  TypeN740 = "luks"
	TypeN740Rbd   TypeN740 = "rbd"
	TypeN740File  TypeN740 = "file"
)

// TypeN746 is QAPI enum 746.
type TypeN746 string

const (
	TypeN746L1Update                 TypeN746 = "l1_update"
	TypeN746L1GrowAllocTable         TypeN746 = "l1_grow_alloc_table"
	TypeN746L1GrowWriteTable         TypeN746 = "l1_grow_write_table"
	TypeN746L1GrowActivateTable      TypeN746 = "l1_grow_activate_table"
	TypeN746L2Load                   TypeN746 = "l2_load"
	TypeN746L2Update                 TypeN746 = "l2_update"
	TypeN746L2UpdateCompressed       TypeN746 = "l2_update_compressed"
	TypeN746L2AllocCowRead           TypeN746 = "l2_alloc_cow_read"
	TypeN746L2AllocWrite             TypeN746 = "l2_alloc_write"
	TypeN746ReadAio                  TypeN746 = "read_aio"
	TypeN746ReadBackingAio           TypeN746 = "read_backing_aio"
	TypeN746ReadCompressed           TypeN746 = "read_compressed"
	TypeN746WriteAio                 TypeN746 = "write_aio"
	TypeN746WriteCompressed          TypeN746 = "write_compressed"
	TypeN746VmstateLoad              TypeN746 = "vmstate_load"
	TypeN746VmstateSave              TypeN746 = "vmstate_save"
	TypeN746CowRead                  TypeN746 = "cow_read"
	TypeN746CowWrite                 TypeN746 = "cow_write"
	TypeN746ReftableLoad             TypeN746 = "reftable_load"
	TypeN746ReftableGrow             TypeN746 = "reftable_grow"
	TypeN746ReftableUpdate           TypeN746 = "reftable_update"
	TypeN746RefblockLoad             TypeN746 = "refblock_load"
	TypeN746RefblockUpdate           TypeN746 = "refblock_update"
	TypeN746RefblockUpdatePart       TypeN746 = "refblock_update_part"
	TypeN746RefblockAlloc            TypeN746 = "refblock_alloc"
	TypeN746RefblockAllocHookup      TypeN746 = "refblock_alloc_hookup"
	TypeN746RefblockAllocWrite       TypeN746 = "refblock_alloc_write"
	TypeN746RefblockAllocWriteBlocks TypeN746 = "refblock_alloc_write_blocks"
	TypeN746RefblockAllocWriteTable  TypeN746 = "refblock_alloc_write_table"
	TypeN746RefblockAllocSwitchTable TypeN746 = "refblock_alloc_switch_table"
	TypeN746ClusterAlloc             TypeN746 = "cluster_alloc"
	TypeN746ClusterAllocBytes        TypeN746 = "cluster_alloc_bytes"
	TypeN746ClusterFree              TypeN746 = "cluster_free"
	TypeN746FlushToOs                TypeN746 = "flush_to_os"
	TypeN746FlushToDisk              TypeN746 = "flush_to_disk"
	TypeN746PwritevRmwHead           TypeN746 = "pwritev_rmw_head"
	TypeN746PwritevRmwAfterHead      TypeN746 = "pwritev_rmw_after_head"
	TypeN746PwritevRmwTail           TypeN746 = "pwritev_rmw_tail"
	TypeN746PwritevRmwAfterTail      TypeN746 = "pwritev_rmw_after_tail"
	TypeN746Pwritev                  TypeN746 = "pwritev"
	TypeN746PwritevZero              TypeN746 = "pwritev_zero"
	TypeN746PwritevDone              TypeN746 = "pwritev_done"
	TypeN746EmptyImagePrepare        TypeN746 = "empty_image_prepare"
	TypeN746L1ShrinkWriteTable       TypeN746 = "l1_shrink_write_table"
	TypeN746L1ShrinkFreeL2Clusters   TypeN746 = "l1_shrink_free_l2_clusters"
	TypeN746CorWrite                 TypeN746 = "cor_write"
	TypeN746ClusterAllocSpace        TypeN746 = "cluster_alloc_space"
	TypeN746None                     TypeN746 = "none"
)

// TypeN747 is QAPI enum 747.
type TypeN747 string

const (
	TypeN747Read        TypeN747 = "read"
	TypeN747Write       TypeN747 = "write"
	TypeN747WriteZeroes TypeN747 = "write-zeroes"
	TypeN747Discard     TypeN747 = "discard"
	TypeN747Flush       TypeN747 = "flush"
	TypeN747BlockStatus TypeN747 = "block-status"
)

// TypeN799 is QAPI enum 799.
type TypeN799 string

const (
	TypeN799Socket TypeN799 = "socket"
	TypeN799Exec   TypeN799 = "exec"
	TypeN799Rdma   TypeN799 = "rdma"
	TypeN799File   TypeN799 = "file"
)

// TypeN803 is QAPI enum 803.
type TypeN803 string

const (
	TypeN803Exact TypeN803 = "exact"
	TypeN803Glob  TypeN803 = "glob"
)

// TypeN804 is QAPI enum 804.
type TypeN804 string

const (
	TypeN804U8  TypeN804 = "u8"
	TypeN804S8  TypeN804 = "s8"
	TypeN804U16 TypeN804 = "u16"
	TypeN804S16 TypeN804 = "s16"
	TypeN804U32 TypeN804 = "u32"
	TypeN804S32 TypeN804 = "s32"
	TypeN804F32 TypeN804 = "f32"
)

// TypeN818 is QAPI enum 818.
type TypeN818 string

const (
	TypeN818Left       TypeN818 = "left"
	TypeN818Middle     TypeN818 = "middle"
	TypeN818Right      TypeN818 = "right"
	TypeN818WheelUp    TypeN818 = "wheel-up"
	TypeN818WheelDown  TypeN818 = "wheel-down"
	TypeN818Side       TypeN818 = "side"
	TypeN818Extra      TypeN818 = "extra"
	TypeN818WheelLeft  TypeN818 = "wheel-left"
	TypeN818WheelRight TypeN818 = "wheel-right"
	TypeN818Touch      TypeN818 = "touch"
)

// TypeN819 is QAPI enum 819.
type TypeN819 string

const (
	TypeN819X TypeN819 = "x"
	TypeN819Y TypeN819 = "y"
)

// TypeN820 is QAPI enum 820.
type TypeN820 string

const (
	TypeN820Begin  TypeN820 = "begin"
	TypeN820Update TypeN820 = "update"
	TypeN820End    TypeN820 = "end"
	TypeN820Cancel TypeN820 = "cancel"
	TypeN820Data   TypeN820 = "data"
)

// TypeN826 is QAPI enum 826.
type TypeN826 string

const (
	TypeN826InUse TypeN826 = "in-use"
	TypeN826Auto  TypeN826 = "auto"
)

// VFIOMIGRATIONEventDeviceState is QAPI enum 582.
type VFIOMIGRATIONEventDeviceState string

const (
	VFIOMIGRATIONEventDeviceStateStop              VFIOMIGRATIONEventDeviceState = "stop"
	VFIOMIGRATIONEventDeviceStateRunning           VFIOMIGRATIONEventDeviceState = "running"
	VFIOMIGRATIONEventDeviceStateStopCopy          VFIOMIGRATIONEventDeviceState = "stop-copy"
	VFIOMIGRATIONEventDeviceStateResuming          VFIOMIGRATIONEventDeviceState = "resuming"
	VFIOMIGRATIONEventDeviceStateRunningP2p        VFIOMIGRATIONEventDeviceState = "running-p2p"
	VFIOMIGRATIONEventDeviceStatePreCopy           VFIOMIGRATIONEventDeviceState = "pre-copy"
	VFIOMIGRATIONEventDeviceStatePreCopyP2p        VFIOMIGRATIONEventDeviceState = "pre-copy-p2p"
	VFIOMIGRATIONEventDeviceStatePreCopyP2pPrepare VFIOMIGRATIONEventDeviceState = "pre-copy-p2p-prepare"
)

// WATCHDOGEventAction is QAPI enum 295.
type WATCHDOGEventAction string

const (
	WATCHDOGEventActionReset     WATCHDOGEventAction = "reset"
	WATCHDOGEventActionShutdown  WATCHDOGEventAction = "shutdown"
	WATCHDOGEventActionPoweroff  WATCHDOGEventAction = "poweroff"
	WATCHDOGEventActionPause     WATCHDOGEventAction = "pause"
	WATCHDOGEventActionDebug     WATCHDOGEventAction = "debug"
	WATCHDOGEventActionNone      WATCHDOGEventAction = "none"
	WATCHDOGEventActionInjectNmi WATCHDOGEventAction = "inject-nmi"
)

// XBlockdevAmendArgsOptionsLuksState is QAPI enum 774.
type XBlockdevAmendArgsOptionsLuksState string

const (
	XBlockdevAmendArgsOptionsLuksStateActive   XBlockdevAmendArgsOptionsLuksState = "active"
	XBlockdevAmendArgsOptionsLuksStateInactive XBlockdevAmendArgsOptionsLuksState = "inactive"
)

// BlockExportAddArgsIothread is a QAPI alternate.
type BlockExportAddArgsIothread struct {
	Value any `json:"-"`
}

func (a BlockExportAddArgsIothread) MarshalJSON() ([]byte, error) {
	return json.Marshal(a.Value)
}

func (a *BlockExportAddArgsIothread) UnmarshalJSON(b []byte) error {
	var v any
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	a.Value = v
	return nil
}

// BlockdevAddArgsBlkdebugImage is a QAPI alternate.
type BlockdevAddArgsBlkdebugImage struct {
	Value any `json:"-"`
}

func (a BlockdevAddArgsBlkdebugImage) MarshalJSON() ([]byte, error) {
	return json.Marshal(a.Value)
}

func (a *BlockdevAddArgsBlkdebugImage) UnmarshalJSON(b []byte) error {
	var v any
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	a.Value = v
	return nil
}

// BlockdevAddArgsQcow2Backing is a QAPI alternate.
type BlockdevAddArgsQcow2Backing struct {
	Value any `json:"-"`
}

func (a BlockdevAddArgsQcow2Backing) MarshalJSON() ([]byte, error) {
	return json.Marshal(a.Value)
}

func (a *BlockdevAddArgsQcow2Backing) UnmarshalJSON(b []byte) error {
	var v any
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	a.Value = v
	return nil
}

// BlockdevAddArgsQcow2OverlapCheck is a QAPI alternate.
type BlockdevAddArgsQcow2OverlapCheck struct {
	Value any `json:"-"`
}

func (a BlockdevAddArgsQcow2OverlapCheck) MarshalJSON() ([]byte, error) {
	return json.Marshal(a.Value)
}

func (a *BlockdevAddArgsQcow2OverlapCheck) UnmarshalJSON(b []byte) error {
	var v any
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	a.Value = v
	return nil
}

// TypeN326 is a QAPI alternate.
type TypeN326 struct {
	Value any `json:"-"`
}

func (a TypeN326) MarshalJSON() ([]byte, error) {
	return json.Marshal(a.Value)
}

func (a *TypeN326) UnmarshalJSON(b []byte) error {
	var v any
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	a.Value = v
	return nil
}

// TypeN733 is a QAPI alternate.
type TypeN733 struct {
	Value any `json:"-"`
}

func (a TypeN733) MarshalJSON() ([]byte, error) {
	return json.Marshal(a.Value)
}

func (a *TypeN733) UnmarshalJSON(b []byte) error {
	var v any
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	a.Value = v
	return nil
}

// XBlockdevSetIothreadArgsIothread is a QAPI alternate.
type XBlockdevSetIothreadArgsIothread struct {
	Value any `json:"-"`
}

func (a XBlockdevSetIothreadArgsIothread) MarshalJSON() ([]byte, error) {
	return json.Marshal(a.Value)
}

func (a *XBlockdevSetIothreadArgsIothread) UnmarshalJSON(b []byte) error {
	var v any
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	a.Value = v
	return nil
}
