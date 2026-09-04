$source = @'
using System;
using System.Runtime.InteropServices;

public static class RemoteInput {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, int data, UIntPtr extraInfo);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extraInfo);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern short VkKeyScan(char character);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
}
'@
Add-Type -TypeDefinition $source

$keys = @{
  'Backspace'=8; 'Tab'=9; 'Enter'=13; 'ShiftLeft'=16; 'ShiftRight'=16; 'ControlLeft'=17; 'ControlRight'=17;
  'AltLeft'=18; 'AltRight'=18; 'Pause'=19; 'CapsLock'=20; 'Escape'=27; 'Space'=32; 'PageUp'=33; 'PageDown'=34;
  'End'=35; 'Home'=36; 'ArrowLeft'=37; 'ArrowUp'=38; 'ArrowRight'=39; 'ArrowDown'=40; 'Insert'=45; 'Delete'=46;
  'MetaLeft'=91; 'MetaRight'=92; 'ContextMenu'=93; 'F1'=112; 'F2'=113; 'F3'=114; 'F4'=115; 'F5'=116; 'F6'=117;
  'F7'=118; 'F8'=119; 'F9'=120; 'F10'=121; 'F11'=122; 'F12'=123; 'NumLock'=144; 'ScrollLock'=145
}

while ($null -ne ($line = [Console]::ReadLine())) {
  try {
    $event = $line | ConvertFrom-Json
    switch ($event.type) {
      'move' {
        $width = [RemoteInput]::GetSystemMetrics(0); $height = [RemoteInput]::GetSystemMetrics(1)
        [RemoteInput]::SetCursorPos([Math]::Round($event.x * ($width - 1)), [Math]::Round($event.y * ($height - 1))) | Out-Null
      }
      'button' {
        $width = [RemoteInput]::GetSystemMetrics(0); $height = [RemoteInput]::GetSystemMetrics(1)
        [RemoteInput]::SetCursorPos([Math]::Round($event.x * ($width - 1)), [Math]::Round($event.y * ($height - 1))) | Out-Null
        $downFlags = @(2, 32, 8); $upFlags = @(4, 64, 16); $index = [Math]::Min([int]$event.button, 2)
        [RemoteInput]::mouse_event($(if ($event.down) { $downFlags[$index] } else { $upFlags[$index] }), 0, 0, 0, [UIntPtr]::Zero)
      }
      'wheel' { [RemoteInput]::mouse_event(2048, 0, 0, $(if ($event.delta -gt 0) { -120 } else { 120 }), [UIntPtr]::Zero) }
      'key' {
        $vk = $keys[$event.code]
        if ($null -eq $vk -and $event.code -match '^Key([A-Z])$') { $vk = [byte][char]$Matches[1] }
        if ($null -eq $vk -and $event.code -match '^Digit([0-9])$') { $vk = 48 + [int]$Matches[1] }
        if ($null -eq $vk -and $event.key.Length -eq 1) { $vk = [RemoteInput]::VkKeyScan([char]$event.key) -band 255 }
        if ($null -ne $vk) { [RemoteInput]::keybd_event([byte]$vk, 0, $(if ($event.down) { 0 } else { 2 }), [UIntPtr]::Zero) }
      }
    }
  } catch { }
}
