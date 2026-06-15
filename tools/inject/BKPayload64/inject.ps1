# inject.ps1 — LoadLibrary DLL injector
# Usage: powershell -ExecutionPolicy Bypass -File inject.ps1 -DllPath C:\full\path\to\BKPayload64.dll

param(
    [string]$ProcessName = "BidKing",
    [string]$DllPath = "$PSScriptRoot\BKPayload64.dll",
    [ValidateSet("CollectionPrices", "CabinetReward", "ClaimCabinetReward", "AutoOperationAgent")]
    [string]$Command = "CollectionPrices"
)

$DllPath = [System.IO.Path]::GetFullPath($DllPath)
if (-not (Test-Path $DllPath)) {
    Write-Error "DLL not found: $DllPath"
    exit 1
}

$proc = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $proc) {
    Write-Error "Process '$ProcessName' not found"
    exit 1
}
Write-Host "Target: $($proc.Name) PID=$($proc.Id)"
Write-Host "DLL:    $DllPath"
Write-Host "Command: $Command"

$documents = [Environment]::GetFolderPath('MyDocuments')
$bidKingDir = Join-Path $documents 'BidKing'
New-Item -ItemType Directory -Force -Path $bidKingDir | Out-Null
Set-Content -Path (Join-Path $bidKingDir 'inject-command.txt') -Value $Command -Encoding ASCII

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class WinApi {
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern IntPtr OpenProcess(uint dwAccess, bool bInherit, int dwPid);
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern IntPtr VirtualAllocEx(IntPtr hProc, IntPtr addr, uint size, uint allocType, uint protect);
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern bool WriteProcessMemory(IntPtr hProc, IntPtr addr, byte[] buf, int size, out int written);
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern IntPtr GetProcAddress(IntPtr hMod, string name);
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern IntPtr GetModuleHandle(string name);
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern IntPtr CreateRemoteThread(IntPtr hProc, IntPtr attr, uint stackSize, IntPtr startAddr, IntPtr param, uint flags, IntPtr threadId);
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern uint WaitForSingleObject(IntPtr h, uint ms);
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern bool VirtualFreeEx(IntPtr hProc, IntPtr addr, int size, uint freeType);
}
"@

$PROCESS_ALL_ACCESS = 0x1F0FFF
$MEM_COMMIT_RESERVE  = 0x3000
$PAGE_READWRITE      = 0x04
$MEM_RELEASE         = 0x8000

$hProc = [WinApi]::OpenProcess($PROCESS_ALL_ACCESS, $false, $proc.Id)
if ($hProc -eq [IntPtr]::Zero) {
    Write-Error "OpenProcess failed (need admin?): error $([System.Runtime.InteropServices.Marshal]::GetLastWin32Error())"
    exit 1
}

try {
    $pathBytes = [System.Text.Encoding]::ASCII.GetBytes($DllPath + "`0")
    $remoteAddr = [WinApi]::VirtualAllocEx($hProc, [IntPtr]::Zero, [uint32]$pathBytes.Length, $MEM_COMMIT_RESERVE, $PAGE_READWRITE)
    if ($remoteAddr -eq [IntPtr]::Zero) {
        Write-Error "VirtualAllocEx failed"
        exit 1
    }

    $written = 0
    $ok = [WinApi]::WriteProcessMemory($hProc, $remoteAddr, $pathBytes, $pathBytes.Length, [ref]$written)
    if (-not $ok) {
        Write-Error "WriteProcessMemory failed"
        exit 1
    }

    $hKernel = [WinApi]::GetModuleHandle("kernel32.dll")
    $loadLibraryA = [WinApi]::GetProcAddress($hKernel, "LoadLibraryA")

    $hThread = [WinApi]::CreateRemoteThread($hProc, [IntPtr]::Zero, 0, $loadLibraryA, $remoteAddr, 0, [IntPtr]::Zero)
    if ($hThread -eq [IntPtr]::Zero) {
        Write-Error "CreateRemoteThread failed"
        exit 1
    }

    Write-Host "Injected — waiting for DLL to load..."
    [WinApi]::WaitForSingleObject($hThread, 5000) | Out-Null
    [WinApi]::CloseHandle($hThread) | Out-Null
    [WinApi]::VirtualFreeEx($hProc, $remoteAddr, 0, $MEM_RELEASE) | Out-Null

    Write-Host "Done. Check C:\Tools\BidKing\tmp\bk-trade-info.txt"
} finally {
    [WinApi]::CloseHandle($hProc) | Out-Null
}
