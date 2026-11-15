param(
    [string]$SourceDir,
    [string]$OutputDir
)

$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host "[AdventureLand V2] $Message"
}

function Get-RelativePathCompat {
    param(
        [string]$BasePath,
        [string]$FullPath
    )

    $base = [System.IO.Path]::GetFullPath($BasePath).TrimEnd('\','/')
    $full = [System.IO.Path]::GetFullPath($FullPath)

    if (-not $full.StartsWith($base, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Path '$full' is not below base path '$base'."
    }

    return $full.Substring($base.Length).TrimStart('\','/')
}

function Get-FlatModuleName {
    param([string]$RelativePath)

    $normalized = $RelativePath -replace "\\", "/"

    if (-not $normalized.EndsWith(".js")) {
        throw "Only JavaScript files can be converted: $RelativePath"
    }

    $withoutExtension = $normalized.Substring(0, $normalized.Length - 3)
    return ($withoutExtension -replace "/", "_")
}

try {
    # Resolve repository root robustly whether the script lives in:
    #   D:\AdventureLand\scripts\build-v2.ps1
    # or
    #   D:\AdventureLand\build-v2.ps1
    $scriptDir = $PSScriptRoot

    if (-not $SourceDir) {
        $candidateSibling = Join-Path $scriptDir "v2"
        $candidateParent  = Join-Path (Split-Path $scriptDir -Parent) "v2"

        if (Test-Path $candidateSibling -PathType Container) {
            $SourceDir = $candidateSibling
        }
        elseif (Test-Path $candidateParent -PathType Container) {
            $SourceDir = $candidateParent
        }
        else {
            throw "Could not find the V2 source directory. Expected either '$candidateSibling' or '$candidateParent'."
        }
    }

    if (-not $OutputDir) {
        $sourceParent = Split-Path ([System.IO.Path]::GetFullPath($SourceDir)) -Parent
        $OutputDir = Join-Path $sourceParent "dist"
    }

    $sourceRoot = (Resolve-Path $SourceDir).Path

    $sourceFiles = @(Get-ChildItem -Path $sourceRoot -Recurse -File -Filter "*.js" | Sort-Object FullName)

    if ($sourceFiles.Count -eq 0) {
        throw "No JavaScript files found below: $sourceRoot"
    }

    Write-Step "Source: $sourceRoot"
    Write-Step "Output: $OutputDir"
    Write-Host ""

    $moduleMap = @{}
    $outputNameMap = @{}

    foreach ($file in $sourceFiles) {
        $relativePath = Get-RelativePathCompat -BasePath $sourceRoot -FullPath $file.FullName
        $relativeUnix = $relativePath -replace "\\", "/"

        $relativeWithoutExtension = $relativeUnix.Substring(0, $relativeUnix.Length - 3)
        $modulePath = "v2/$relativeWithoutExtension"
        $flatModuleName = Get-FlatModuleName -RelativePath ("v2/" + $relativeUnix)
        $outputFileName = "$flatModuleName.js"

        if ($outputNameMap.ContainsKey($outputFileName)) {
            throw "Flattening collision: '$relativeUnix' and '$($outputNameMap[$outputFileName])' both map to '$outputFileName'."
        }

        $moduleMap[$modulePath] = $flatModuleName
        $outputNameMap[$outputFileName] = $relativeUnix
    }

    # Match only static V2 require_code() references such as:
    # require_code("v2/core/logger")
    # require_code('v2/core/logger')
    $referencePattern = 'require_code\s*\(\s*(["''])(v2\/[^"'']+)\1\s*\)'

    $unresolvedReferences = New-Object System.Collections.ArrayList

    foreach ($file in $sourceFiles) {
        $content = Get-Content -Path $file.FullName -Raw
        $matches = [regex]::Matches($content, $referencePattern)

        foreach ($match in $matches) {
            $reference = $match.Groups[2].Value

            if (-not $moduleMap.ContainsKey($reference)) {
                $relativePath = Get-RelativePathCompat -BasePath $sourceRoot -FullPath $file.FullName
                [void]$unresolvedReferences.Add("$relativePath -> $reference")
            }
        }
    }

    if ($unresolvedReferences.Count -gt 0) {
        Write-Host ""
        Write-Host "Unresolved V2 require_code() references:" -ForegroundColor Red

        foreach ($reference in $unresolvedReferences) {
            Write-Host "  $reference" -ForegroundColor Red
        }

        throw "Build stopped because one or more V2 module references could not be resolved."
    }

    if (Test-Path $OutputDir) {
        Write-Step "Cleaning output directory..."
        Remove-Item -Path $OutputDir -Recurse -Force
    }

    New-Item -Path $OutputDir -ItemType Directory -Force | Out-Null

    Write-Step "Building flat Adventure Land CODE files..."
    Write-Host ""

    $generated = @()

    foreach ($file in $sourceFiles) {
        $relativePath = Get-RelativePathCompat -BasePath $sourceRoot -FullPath $file.FullName
        $relativeUnix = $relativePath -replace "\\", "/"

        $relativeWithoutExtension = $relativeUnix.Substring(0, $relativeUnix.Length - 3)
        $sourceModulePath = "v2/$relativeWithoutExtension"
        $flatModuleName = $moduleMap[$sourceModulePath]
        $outputPath = Join-Path $OutputDir "$flatModuleName.js"

        $content = Get-Content -Path $file.FullName -Raw

        $content = [regex]::Replace(
            $content,
            $referencePattern,
            {
                param($match)

                $quote = $match.Groups[1].Value
                $reference = $match.Groups[2].Value
                $flatReference = $moduleMap[$reference]

                return "require_code($quote$flatReference$quote)"
            }
        )

        # UTF-8 without BOM
        [System.IO.File]::WriteAllText(
            $outputPath,
            $content,
            (New-Object System.Text.UTF8Encoding($false))
        )

        $generated += [PSCustomObject]@{
            Source = "v2/$relativeUnix"
            Slot   = $flatModuleName
            File   = $outputPath
        }
    }

    $remainingNestedReferences = New-Object System.Collections.ArrayList

    foreach ($item in $generated) {
        $content = Get-Content -Path $item.File -Raw

        if ([regex]::IsMatch($content, 'require_code\s*\(\s*(["''])v2\/')) {
            [void]$remainingNestedReferences.Add($item.File)
        }
    }

    if ($remainingNestedReferences.Count -gt 0) {
        throw "Build verification failed: nested V2 require_code() references remain in generated files."
    }

    foreach ($item in $generated) {
        Write-Host ("{0,-45} -> {1}.js" -f $item.Source, $item.Slot)
    }

    Write-Host ""
    Write-Step ("Generated {0} files." -f $generated.Count)
    Write-Step "0 unresolved V2 module references."
    Write-Step "Build successful."
    Write-Step "Adventure Land entry slot: v2_main"

    Write-Host ""
    Write-Host "Output directory:"
    Write-Host "  $OutputDir"
}
catch {
    Write-Host ""
    Write-Host "BUILD FAILED" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red

    if ($_.InvocationInfo -and $_.InvocationInfo.PositionMessage) {
        Write-Host ""
        Write-Host $_.InvocationInfo.PositionMessage -ForegroundColor DarkRed
    }

    Write-Host ""
    Write-Host "Press Enter to close..."
    Read-Host | Out-Null
    exit 1
}
