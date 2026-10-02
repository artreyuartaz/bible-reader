# Replaces every backtick (`) with an apostrophe (') in Bible_Books\*.md and Dictionary\*.md.
# Works on raw bytes (0x60 -> 0x27): fast, and safe for UTF-8 because 0x60 never occurs inside a
# multi-byte sequence. Files without a backtick are not touched. The read-only attribute is
# cleared for the write and restored afterwards.
$root  = $PSScriptRoot
$files = 'Bible_Books', 'Dictionary' | ForEach-Object { Get-ChildItem (Join-Path $root $_) -Filter *.md }
$total = 0; $changed = 0

foreach ($f in $files) {
    $bytes = [System.IO.File]::ReadAllBytes($f.FullName)
    $n = 0
    $i = [Array]::IndexOf($bytes, [byte]0x60)
    while ($i -ge 0) {
        $bytes[$i] = 0x27; $n++
        $i = [Array]::IndexOf($bytes, [byte]0x60, $i + 1)
    }
    if ($n -eq 0) { continue }

    $wasRO = $f.IsReadOnly
    if ($wasRO) { $f.IsReadOnly = $false }
    [System.IO.File]::WriteAllBytes($f.FullName, $bytes)
    if ($wasRO) { $f.IsReadOnly = $true }

    $total += $n; $changed++
    Write-Host ("{0,-28} {1,5} replaced" -f $f.Name, $n)
}
Write-Host "Done: $total replacements in $changed of $($files.Count) files."
