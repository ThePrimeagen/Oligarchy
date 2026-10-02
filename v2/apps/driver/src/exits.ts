// How the driver's exit tells its automation client how the drive ended. 0 is a drive that ran to
// its end, whatever its test said, and 1 a system failure, its reason on stderr. 124 is a drive
// its run ceiling ended, as timeout(1) exits.
export const TIMED_OUT = 124;
