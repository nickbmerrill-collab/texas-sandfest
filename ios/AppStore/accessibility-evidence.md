# Accessibility Nutrition Label evidence

Status: **evidence in progress; publish no claims yet**

Apple requires every common task to work with a feature on every supported
device before that feature can be claimed. The App Store Connect questionnaire
therefore remains unchanged and `supportedClaims` remains empty.

Official criteria:

- [Overview of Accessibility Nutrition Labels](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/overview-of-accessibility-nutrition-labels)
- [VoiceOver](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/voiceover-evaluation-criteria)
- [Larger Text](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/larger-text-evaluation-criteria)
- [Differentiate Without Color Alone](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/differentiate-without-color-alone-evaluation-criteria)
- [Sufficient Contrast](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/sufficient-contrast-evaluation-criteria)
- [Reduced Motion](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/reduced-motion-evaluation-criteria)

## Production common-task inventory

The production build is visitor-only. It has no native login, purchase, or
staff-admin task. Current common visitor tasks are:

1. Open the app and understand event dates and offline status on Today.
2. Review the daily schedule or reach the official schedule while details are pending.
3. Navigate Beach guidance and switch between beach information modes.
4. Ask Sandy a question and receive the offline staff-contact fallback.
5. Review ticket availability, reach the official ticket source, and open and dismiss the ticket QR scanner.

## Automated evidence

On August 14, 2026, `test:ios-accessibility-labels` and
`test:ios-accessibility-labels:ipad` passed this complete common-task inventory
on an iPhone 17 Pro simulator running iOS 26.5 and an iPad Pro 13-inch (M5)
simulator running iPadOS 26.5. Each run used:

- AX3 `accessibility-extra-large` text, exceeding 200%.
- Increase Contrast enabled.
- The simulator's actual Reduce Motion preference, with an in-app test probe
  proving that the active SwiftUI environment received the setting.
- Apple's XCUITest accessibility audit on each reached state.
- A deliberately unavailable API to prove the offline visitor path.

The same day, `test:ios-accessibility-display` and
`test:ios-accessibility-display:ipad` passed the complete inventory on the same
iPhone and iPad simulators with:

- Bold Text enabled through the simulator's real accessibility preference.
- Reduce Transparency enabled through the simulator's real accessibility preference.
- Differentiate Without Color enabled through the simulator's real accessibility preference.
- An in-app SwiftUI environment probe proving all three settings were active.
- Dynamic Type, hit-target, trait, description, and text-clipping audits on each reached state.
- Standard and AX3/Increase Contrast lanes retaining the full contrast audit;
  iOS 26's sampler produces bounded false contrast and element-detection
  results while Reduce Transparency is active even for dark navy on cream,
  black on white, and white on teal.

The scanner is full-screen on iPhone and iPad. Its simulator status and live
device positioning hint use Dynamic Type and explicit accessibility elements.

## Evidence still required before publishing a claim

- Proficient manual VoiceOver testing of every common task on iPhone and iPad.
- Grayscale testing on physical hardware to prove tasks do not rely on color
  alone. The iOS 26.5 simulator image does not expose Color Filters in Settings,
  and a plist-only grayscale flag does not activate the public accessibility state.
- Manual confirmation on Apple silicon Mac and Apple Vision Pro, or an explicit
  product decision to remove those enabled device availabilities.
- A final portal review against Apple's then-current criteria.

`supportedClaims`: `[]`
