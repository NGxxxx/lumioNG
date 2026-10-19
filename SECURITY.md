# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Report it privately through GitHub:
go to the repository's **Security** tab and choose **Report a vulnerability**
([direct link](https://github.com/NGxxxx/lumioNG/security/advisories/new)). If you cannot use
GitHub, email [ngx.giang@proton.me](mailto:ngx.giang@proton.me) with "LumioNG security" in the
subject.

Include the LumioNG version (Help → About → Copy info), your OS, and steps to reproduce. LumioNG is
maintained in spare time, so replies are best-effort, but security reports are handled first. Once
a fix is released, the advisory is published and you are credited unless you prefer otherwise.

## Supported versions

Security fixes go into the latest release. Please update before reporting.

## Scope

LumioNG stores connection passwords in the OS keychain (or a master-password vault), keeps an
audit log of writes and runs an optional local MCP server. Issues in these areas — leaking secrets,
bypassing read-only or production safeguards, or MCP access beyond what a connection allows — are
especially welcome.
