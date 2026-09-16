# German World Club — Business Description

This document describes the **business logic and behavior** of the existing application, independent of implementation technology, so the same system can be rebuilt on a different stack while preserving how it actually works for members, staff, and partners.


### 6.1 Onboarding & verification workflow Update
- A new mobile-app user registers by providing their **full name**, **mobile number**, **birthday**
- select primary country of residence then **verifies their mobile number**.
- The user then **verifies their email address**.
- After verification, the user is shown a **"waiting for approval"** screen.
- Staff review the submission and approve or deny access (with a reason on denial); approval/denial triggers an email notification.
- "Demo"/sample accounts bypass this approval automatically, for testing/demo purposes.
- Changing the device a user logs in from **invalidates prior approval**, forcing re-submission/re-approval — approval is tied to a specific device.
- After approval the second onboarding step comes in
    - Where you are you living right now: **German**
    - How do you describe yourself: **Family**, **Single**
    - What is your job description: **Employeer**, **Employee**, **Free-lancer**, **Self-Employer**, **Unoccupied**
- After approval the second onboarding step comes in
    - Where you are you living right now: **Non German**
    - What is the nearest city of you current location: **Country**, **City**
    - What is your job description: **Employeer**, **Employee**, **Free-lancer**, **Self-Employer**, **Unoccupied**



### 13 UI Update 

 #### Phase 1 
 - The mobile application tabs are: **Profile**, **Thread**, and **Event** 