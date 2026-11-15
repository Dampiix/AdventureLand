param(
    [string]$DistDir,
    [string]$CodesDir = "D:\AdventureLand\codes"
)

$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host "[AdventureLand V2 Deploy] $Message"
}

try {
    $scriptDir = $PSScriptRoot

    if (-not $DistDir) {
        $candidateSibling = Join-Path $scriptDir "dist"
        $candidateParent = Join-Path (Split-Path $scriptDir -Parent) "dist"

        if (Test-Path $candidateSibling -PathType Container) {
            $DistDir = $candidateSibling
        }
        elseif (Test-Path $candidateParent -PathType Container) {
            $DistDir = $candidateParent
        }
        else {
            throw "Could not find dist directory. Run build-v2.ps1 first."
        }
    }

    if (-not (Test-Path $CodesDir -PathType Container)) {
        throw "Adventure Land codes directory does not exist: $CodesDir"
    }

    $distRoot = (Resolve-Path $DistDir).Path
    $codesRoot = (Resolve-Path $CodesDir).Path

    $mapping = @(
        @{ Source = "v2_config_characters.js";       Target = "v2_config_characters.51.js" },
        @{ Source = "v2_config_settings.js";         Target = "v2_config_settings.52.js" },
        @{ Source = "v2_core_context.js";            Target = "v2_core_context.53.js" },
        @{ Source = "v2_core_locks.js";              Target = "v2_core_locks.54.js" },
        @{ Source = "v2_core_logger.js";             Target = "v2_core_logger.55.js" },
        @{ Source = "v2_core_scheduler.js";          Target = "v2_core_scheduler.56.js" },
        @{ Source = "v2_roles_mage.js";      Target = "v2_role_mage.57.js" },
	@{ Source = "v2_roles_merchant.js";  Target = "v2_role_merchant.58.js" },
	@{ Source = "v2_roles_priest.js";    Target = "v2_role_priest.59.js" },
	@{ Source = "v2_roles_warrior.js";   Target = "v2_role_warrior.60.js" },
        @{ Source = "v2_services_communication.js";  Target = "v2_services_communication.61.js" },
        @{ Source = "v2_services_movement.js";       Target = "v2_services_movement.62.js" },
        @{ Source = "v2_main.js";                    Target = "v2_main.63.js" }
    )

    Write-Step "Dist:  $distRoot"
    Write-Step "Codes: $codesRoot"
    Write-Host ""

    # Validate everything before copying anything.
    $missingSources = @()

    foreach ($item in $mapping) {
        $sourcePath = Join-Path $distRoot $item.Source

        if (-not (Test-Path $sourcePath -PathType Leaf)) {
            $missingSources += $sourcePath
        }
    }

    if ($missingSources.Count -gt 0) {
        Write-Host "Missing generated V2 files:" -ForegroundColor Red
        foreach ($path in $missingSources) {
            Write-Host "  $path" -ForegroundColor Red
        }

        throw "Deployment stopped. Run build-v2.ps1 and verify the dist output."
    }

    # Verify that the expected server-created local slot files exist.
    # We do not create new target filenames here, because Adventure Land owns
    # the slot-number/file-name association.
    $missingTargets = @()

    foreach ($item in $mapping) {
        $targetPath = Join-Path $codesRoot $item.Target

        if (-not (Test-Path $targetPath -PathType Leaf)) {
            $missingTargets += $targetPath
        }
    }

    if ($missingTargets.Count -gt 0) {
        Write-Host "Missing Adventure Land slot files:" -ForegroundColor Red
        foreach ($path in $missingTargets) {
            Write-Host "  $path" -ForegroundColor Red
        }

        throw "Deployment stopped. Confirm the V2 slots 51-63 were bootstrapped and are visible through /codes."
    }

    Write-Step "Deploying V2 files..."
    Write-Host ""

    foreach ($item in $mapping) {
        $sourcePath = Join-Path $distRoot $item.Source
        $targetPath = Join-Path $codesRoot $item.Target

        # Preserve UTF-8 source bytes exactly as generated in dist.
        [System.IO.File]::WriteAllBytes(
            $targetPath,
            [System.IO.File]::ReadAllBytes($sourcePath)
        )

        Write-Host ("{0,-38} -> {1}" -f $item.Source, $item.Target)
    }

    Write-Host ""
    Write-Step ("Deployed {0} V2 slot files." -f $mapping.Count)
    Write-Step "No V1 files or folders were touched."
    Write-Step "Adventure Land should now auto-save/synchronize the changed slot files."
    Write-Host ""
    Write-Host "Entry slot:"
    Write-Host "  v2_main (slot 63)"
}
catch {
    Write-Host ""
    Write-Host "DEPLOY FAILED" -ForegroundColor Red
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
