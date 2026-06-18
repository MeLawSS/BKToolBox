param(
    [string]$ProcessName = "BidKing",
    [string]$ShellcodeHex = "",
    [int]$ResultSize = 4096,
    [switch]$NoWait,
    [int]$TimeoutMs = 5000
)

if ($ShellcodeHex.Length -eq 0) {
    Write-Error "ShellcodeHex is required"
    exit 1
}
if ($ShellcodeHex.Length % 2 -ne 0) {
    Write-Error "ShellcodeHex must have even length"
    exit 1
}

$bytes = [byte[]]::new($ShellcodeHex.Length / 2)
for ($i = 0; $i -lt $bytes.Length; $i++) {
    $bytes[$i] = [Convert]::ToByte($ShellcodeHex.Substring($i * 2, 2), 16)
}

$proc = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $proc) {
    Write-Error "process not found: ${ProcessName}.exe"
    exit 1
}

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class BkScInject {
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern IntPtr OpenProcess(uint a, bool b, int c);
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern IntPtr VirtualAllocEx(IntPtr h, IntPtr a, uint s, uint t, uint p);
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern bool WriteProcessMemory(IntPtr h, IntPtr a, byte[] b, int s, out int w);
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern bool ReadProcessMemory(IntPtr h, IntPtr a, byte[] b, int s, out int r);
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern IntPtr CreateRemoteThread(IntPtr h, IntPtr a, uint s, IntPtr fn, IntPtr p, uint f, IntPtr t);
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern uint WaitForSingleObject(IntPtr h, uint ms);
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern bool VirtualFreeEx(IntPtr h, IntPtr a, int s, uint t);
}
"@

$PROCESS_ALL_ACCESS = 0x1F0FFF
$MEM_COMMIT_RESERVE  = 0x3000
$PAGE_EXECUTE_READWRITE = 0x40
$PAGE_READWRITE      = 0x04
$MEM_RELEASE         = 0x8000
$WAIT_TIMEOUT_CODE   = 0x102

$hProc = [BkScInject]::OpenProcess($PROCESS_ALL_ACCESS, $false, $proc.Id)
if ($hProc -eq [IntPtr]::Zero) {
    Write-Error "OpenProcess failed: error $([System.Runtime.InteropServices.Marshal]::GetLastWin32Error())"
    exit 1
}

$scAddr      = [IntPtr]::Zero
$scratchAddr = [IntPtr]::Zero
try {
    $scAddr = [BkScInject]::VirtualAllocEx($hProc, [IntPtr]::Zero, [uint32]$bytes.Length, $MEM_COMMIT_RESERVE, $PAGE_EXECUTE_READWRITE)
    if ($scAddr -eq [IntPtr]::Zero) { Write-Error "VirtualAllocEx(shellcode) failed"; exit 1 }

    $w = 0
    if (-not [BkScInject]::WriteProcessMemory($hProc, $scAddr, $bytes, $bytes.Length, [ref]$w)) {
        Write-Error "WriteProcessMemory failed"; exit 1
    }

    $scratchAddr = [BkScInject]::VirtualAllocEx($hProc, [IntPtr]::Zero, [uint32]$ResultSize, $MEM_COMMIT_RESERVE, $PAGE_READWRITE)
    if ($scratchAddr -eq [IntPtr]::Zero) { Write-Error "VirtualAllocEx(scratch) failed"; exit 1 }

    $hThread = [BkScInject]::CreateRemoteThread($hProc, [IntPtr]::Zero, 0, $scAddr, $scratchAddr, 0, [IntPtr]::Zero)
    if ($hThread -eq [IntPtr]::Zero) { Write-Error "CreateRemoteThread failed"; exit 1 }

    if (-not $NoWait) {
        $waitResult = [BkScInject]::WaitForSingleObject($hThread, [uint32]$TimeoutMs)
        [BkScInject]::CloseHandle($hThread) | Out-Null
        if ($waitResult -eq $WAIT_TIMEOUT_CODE) {
            Write-Error "shellcode thread timeout after ${TimeoutMs}ms"
            exit 1
        }
        $readBuf = [byte[]]::new($ResultSize)
        $r = 0
        [BkScInject]::ReadProcessMemory($hProc, $scratchAddr, $readBuf, $ResultSize, [ref]$r) | Out-Null
        $nullIdx = [Array]::IndexOf($readBuf, [byte]0)
        if ($nullIdx -gt 0) { $readBuf = $readBuf[0..($nullIdx - 1)] }
        elseif ($nullIdx -eq 0) { $readBuf = [byte[]]::new(0) }
        Write-Output ([System.Text.Encoding]::UTF8.GetString($readBuf))
    } else {
        [BkScInject]::CloseHandle($hThread) | Out-Null
        Write-Output ""
    }
} finally {
    if ($scAddr -ne [IntPtr]::Zero)      { [BkScInject]::VirtualFreeEx($hProc, $scAddr, 0, $MEM_RELEASE) | Out-Null }
    if ($scratchAddr -ne [IntPtr]::Zero) { [BkScInject]::VirtualFreeEx($hProc, $scratchAddr, 0, $MEM_RELEASE) | Out-Null }
    [BkScInject]::CloseHandle($hProc) | Out-Null
}
