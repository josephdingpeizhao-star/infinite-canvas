$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$desktopRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$releaseRoot = [System.IO.Path]::GetFullPath((Join-Path $desktopRoot "release"))
$sourceRoot = [System.IO.Path]::GetFullPath((Join-Path $releaseRoot "win-unpacked"))
$guidePath = [System.IO.Path]::GetFullPath((Join-Path $desktopRoot "portable\README-zh-CN.txt"))
$pythonRoot = [System.IO.Path]::GetFullPath((Join-Path $desktopRoot "vendor\python-runtime"))
$workspaceRoot = [System.IO.Path]::GetFullPath((Join-Path $desktopRoot "..\.."))
$packageName = "InfiniteCanvas-Portable-0.1.0-x64"
$zipPath = [System.IO.Path]::GetFullPath((Join-Path $releaseRoot "$packageName.zip"))
$releasePrefix = $releaseRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
$batchFolderName = ([string][char]0x676F) + ([string][char]0x7C7B)

function Add-ArchiveFile {
    param(
        [System.IO.Compression.ZipArchive]$Archive,
        [string]$SourcePath,
        [string]$EntryName
    )
    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
        $Archive,
        $SourcePath,
        $EntryName.Replace("\", "/"),
        [System.IO.Compression.CompressionLevel]::Optimal
    )
}

function Add-ArchiveTree {
    param(
        [System.IO.Compression.ZipArchive]$Archive,
        [string]$TreeRoot,
        [string]$EntryRoot
    )
    $resolvedRoot = [System.IO.Path]::GetFullPath($TreeRoot)
    $sourcePrefix = $resolvedRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
    foreach ($file in Get-ChildItem -LiteralPath $resolvedRoot -Recurse -File -Force | Sort-Object FullName) {
        if ($file.Name -like "*.test.*") {
            continue
        }
        if (-not $file.FullName.StartsWith($sourcePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing to package a file outside its declared source tree: $($file.FullName)"
        }
        $relativePath = $file.FullName.Substring($sourcePrefix.Length)
        if ($relativePath -match '(^|[\\/])__pycache__([\\/]|$)' -or $relativePath.EndsWith(".pyc", [System.StringComparison]::OrdinalIgnoreCase)) {
            continue
        }
        Add-ArchiveFile -Archive $Archive -SourcePath $file.FullName -EntryName "$EntryRoot/$relativePath"
    }
}

$workflowCandidates = @(
    Get-ChildItem -LiteralPath $workspaceRoot -Directory -Force | Where-Object {
        Test-Path -LiteralPath (Join-Path $_.FullName "categories\_shared\category-recipe.schema.json") -PathType Leaf
    } | Where-Object {
        Test-Path -LiteralPath (Join-Path $_.FullName "canvas-bridge\spike_canvas_push.py") -PathType Leaf
    }
)
if ($workflowCandidates.Count -ne 1) {
    throw "Expected exactly one workflow source beside infinite-canvas; found $($workflowCandidates.Count)"
}
$workflowSource = [System.IO.Path]::GetFullPath($workflowCandidates[0].FullName)

if (-not $zipPath.StartsWith($releasePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to replace a ZIP outside the desktop release directory: $zipPath"
}
if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot "Infinite Canvas.exe") -PathType Leaf)) {
    throw "Portable source is incomplete: Infinite Canvas.exe is missing"
}
if (-not (Test-Path -LiteralPath $guidePath -PathType Leaf)) {
    throw "Portable guide is missing: $guidePath"
}
if (-not (Test-Path -LiteralPath (Join-Path $pythonRoot "python.exe") -PathType Leaf)) {
    throw "Portable Python runtime is missing: $pythonRoot"
}

$workflowTrees = @(
    @{ Source = "canvas-bridge"; Target = "canvas-bridge" },
    @{ Source = "categories"; Target = "categories" },
    @{ Source = "scripts"; Target = "scripts" },
    @{ Source = "schemas"; Target = "schemas" },
    @{ Source = ".agents\skills"; Target = ".agents/skills" }
)
$manifestFiles = @(
    "asset_manifest.template.json",
    "batch_manifest.template.json",
    "workflow_architecture.json",
    "workflow_graph.template.json"
)
foreach ($tree in $workflowTrees) {
    if (-not (Test-Path -LiteralPath (Join-Path $workflowSource $tree.Source) -PathType Container)) {
        throw "Workflow runtime directory is missing: $($tree.Source)"
    }
}
foreach ($name in $manifestFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $workflowSource "manifests\$name") -PathType Leaf)) {
        throw "Workflow manifest template is missing: $name"
    }
}

if (Test-Path -LiteralPath $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
}

$archive = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    Add-ArchiveTree -Archive $archive -TreeRoot $sourceRoot -EntryRoot $packageName
    Add-ArchiveTree -Archive $archive -TreeRoot $pythonRoot -EntryRoot "$packageName/python-runtime"
    foreach ($tree in $workflowTrees) {
        Add-ArchiveTree `
            -Archive $archive `
            -TreeRoot (Join-Path $workflowSource $tree.Source) `
            -EntryRoot "$packageName/workflow-runtime/$($tree.Target)"
    }
    foreach ($name in $manifestFiles) {
        Add-ArchiveFile `
            -Archive $archive `
            -SourcePath (Join-Path $workflowSource "manifests\$name") `
            -EntryName "$packageName/workflow-runtime/manifests/$name"
    }
    [void]$archive.CreateEntry("$packageName/workflow-runtime/reports/")
    [void]$archive.CreateEntry("$packageName/$batchFolderName/")
    Add-ArchiveFile -Archive $archive -SourcePath $guidePath -EntryName "$packageName/README-zh-CN.txt"
}
finally {
    $archive.Dispose()
}

$zip = Get-Item -LiteralPath $zipPath
Write-Output "Portable ZIP created: $($zip.FullName)"
Write-Output "Portable ZIP bytes: $($zip.Length)"
