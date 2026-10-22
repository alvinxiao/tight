# Accessibility checks and remaining qualification

The browser suite includes a keyboard journey from creating a game through assigning a faction, color, and player, taking a strategy card, changing phases, and scoring an objective. It also checks focus restoration after closing a dialog and recovery from an unknown route. The host/phone journey locates setup selects by their accessible names.

An axe scan checks WCAG 2 A/AA and WCAG 2.1 AA rules on the home screen, new-game dialog, faction setup, strategy phase, action phase, and expanded scoring controls, including dark-theme and phone-width scoring. These are regression checks for the rendered states, not a claim of complete accessibility compliance. Failures retain the affected screen, rule, and node information in the test attachment and CI output.

Selects use stable IDs to associate labels with their controls. Full-screen dialogs have accessible names and support Escape. Buttons that change a game and buttons that expand details are separate controls; objective detail buttons no longer sit inside checkbox labels. Color choices retain text labels. Both themes select text colors using a 4.5:1 contrast threshold. The theme button names the theme it will switch to.

Before release, issue #17 still requires assistive-technology and manual keyboard qualification of the remaining dialogs, planet editing, multiple simultaneous faction editors, reference pages, and phone clients. Check both themes, 200% and 400% zoom, visible focus, contrast and non-color state cues, error announcements, touch targets, and focus after destructive actions. Automated scans cannot establish those results by themselves.
