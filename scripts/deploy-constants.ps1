# Shared production deployment constants (dot-source from other deploy scripts).
$script:ProductionWebUrl = 'https://lanternstudy.com'
$script:ProductionWebDomain = 'lanternstudy.com'
$script:ProductionFromEmail = 'noreply@lanternstudy.com'
$script:SupportEmail = 'support@lanternstudy.com'
$script:PrivacyEmail = 'privacy@lanternstudy.com'
$script:LegacyPagesUrl = 'https://lantern-study.pages.dev'
$script:SupabaseProjectRef = 'tiizkjhbrnaibaagmurl'

function Get-AuthRedirectUrlList([string]$SiteUrl) {
    $legacy = $script:LegacyPagesUrl
    return @(
        $SiteUrl
        "$SiteUrl/reset-password"
        "https://www.$($script:ProductionWebDomain)"
        "https://www.$($script:ProductionWebDomain)/reset-password"
        $legacy
        "$legacy/reset-password"
        'http://localhost:5173'
        'http://localhost:5173/reset-password'
        'http://127.0.0.1:5173'
        'http://127.0.0.1:5173/reset-password'
        'lanternstudy://'
        'lanternstudy://reset-password'
        'lanternstudy://verify-email'
    )
}
