$ErrorActionPreference = "Stop"

$pythonVersion = "3.12.10"
$embedUrl = "https://www.python.org/ftp/python/$pythonVersion/python-$pythonVersion-embeddable-amd64.zip"
$desktopRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$vendorRoot = [System.IO.Path]::GetFullPath((Join-Path $desktopRoot "vendor"))
$runtimeRoot = [System.IO.Path]::GetFullPath((Join-Path $vendorRoot "python-runtime"))
$vendorPrefix = $vendorRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
$portableSearchPaths = @(
    "Lib\site-packages",
    "..\workflow-runtime\canvas-bridge",
    "..\workflow-runtime\scripts"
)

if (-not $runtimeRoot.StartsWith($vendorPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to prepare Python outside the desktop vendor directory: $runtimeRoot"
}

$pythonExe = Join-Path $runtimeRoot "python.exe"
if (Test-Path -LiteralPath $pythonExe -PathType Leaf) {
    $probe = & $pythonExe -c "import PIL,importlib.metadata,sys; print(sys.version.split()[0], PIL.__version__, importlib.metadata.version('jsonschema'))" 2>$null
    $existingPth = Get-ChildItem -LiteralPath $runtimeRoot -Filter "python*._pth" -File | Select-Object -First 1
    $existingPthLines = if ($existingPth) { @(Get-Content -LiteralPath $existingPth.FullName) } else { @() }
    $hasPortableSearchPaths = @($portableSearchPaths | Where-Object { $existingPthLines -notcontains $_ }).Count -eq 0
    if ($LASTEXITCODE -eq 0 -and $probe -eq "$pythonVersion 12.2.0 4.26.0" -and $hasPortableSearchPaths) {
        Write-Output "Portable Python already prepared: $runtimeRoot"
        exit 0
    }
}

$buildPython = $null
$buildPythonPrefix = @()
$pyLauncher = Get-Command "py.exe" -ErrorAction SilentlyContinue
if ($pyLauncher) {
    $buildPython = $pyLauncher.Source
    $buildPythonPrefix = @("-3.12")
} else {
    $pythonCommand = Get-Command "python.exe" -ErrorAction SilentlyContinue
    if ($pythonCommand) {
        $buildPython = $pythonCommand.Source
    }
}
if (-not $buildPython) {
    throw "Building the portable runtime requires Python 3.12 with pip on the packaging computer"
}

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("infinite-canvas-python-" + [guid]::NewGuid().ToString("N"))
$tempPrefix = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
$resolvedTemp = [System.IO.Path]::GetFullPath($tempRoot)
if (-not $resolvedTemp.StartsWith($tempPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to use a temporary directory outside the system temp root: $resolvedTemp"
}

try {
    if (Test-Path -LiteralPath $runtimeRoot) {
        Remove-Item -LiteralPath $runtimeRoot -Recurse -Force
    }
    New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
    New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null

    $embedZip = Join-Path $tempRoot "python-embed.zip"
    Invoke-WebRequest -Uri $embedUrl -OutFile $embedZip -UseBasicParsing
    Expand-Archive -LiteralPath $embedZip -DestinationPath $runtimeRoot -Force

    $sitePackages = Join-Path $runtimeRoot "Lib\site-packages"
    New-Item -ItemType Directory -Path $sitePackages -Force | Out-Null
    $pipArgs = @($buildPythonPrefix) + @(
        "-m", "pip", "install",
        "--disable-pip-version-check",
        "--no-compile",
        "--only-binary=:all:",
        "--target", $sitePackages,
        "Pillow==12.2.0",
        "jsonschema==4.26.0"
    )
    & $buildPython @pipArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to install the portable Python dependencies"
    }

    $pthFile = Get-ChildItem -LiteralPath $runtimeRoot -Filter "python*._pth" -File | Select-Object -First 1
    if (-not $pthFile) {
        throw "Portable Python path configuration is missing"
    }
    $pthLines = Get-Content -LiteralPath $pthFile.FullName
    foreach ($searchPath in $portableSearchPaths) {
        if ($pthLines -notcontains $searchPath) {
            $pthLines += $searchPath
        }
    }
    [System.IO.File]::WriteAllLines($pthFile.FullName, $pthLines, [System.Text.UTF8Encoding]::new($false))

    Get-ChildItem -LiteralPath $runtimeRoot -Recurse -Directory -Force |
        Where-Object { $_.Name -eq "__pycache__" } |
        Sort-Object FullName -Descending |
        Remove-Item -Recurse -Force

    $probe = & $pythonExe -c "import PIL,importlib.metadata,sys; print(sys.version.split()[0], PIL.__version__, importlib.metadata.version('jsonschema'))" 2>$null
    if ($LASTEXITCODE -ne 0 -or $probe -ne "$pythonVersion 12.2.0 4.26.0") {
        throw "Portable Python dependency verification failed: $probe"
    }
    Write-Output "Portable Python prepared: $runtimeRoot"
}
finally {
    if (Test-Path -LiteralPath $tempRoot) {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force
    }
}
