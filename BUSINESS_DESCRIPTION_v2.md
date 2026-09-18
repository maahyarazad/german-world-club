# German World Club — Business Description

This document describes the **business logic and behavior** of the existing application, independent of implementation technology, so the same system can be rebuilt on a different stack while preserving how it actually works for members, staff, and partners.


### Onboarding & verification workflow Update
1. A new mobile-app user registers by providing their **full name**, **mobile number**, **birthday**, **gender**
2. select primary country of residence then **verifies their mobile number**.
3. The user then **verifies their email address**.
4. After verification, the user is shown a **"waiting for approval"** screen.
5. Staff review the submission and approve or deny access (with a reason on denial); approval/denial triggers an email notification.
6. "Demo"/sample accounts bypass this approval automatically, for testing/demo purposes.


### Onboarding & verification workflow Update
- After approval, the second onboarding step comes in, branching on the country of residence selected earlier:
    - **If German:**
        1. Do you already know where you'll be setting down, or should we help you find the right place: **Yes**, **Please Help**
        2. What languages do you speak: **Language Drop Down** (Click on the drop down add a bubble in the)
        3. What is the highest degree/level of quilification **No formal qualification**,**Secondary/High School**,**Diploma / Certificate**,**Associate Degree**,**Bachelor's Degree**,**Master's Degree**,**Doctorate (PhD)**,**Professional Qualification (e.g., CA, CPA, MBA)**
        4. What is you current occupations/professions
                -  Student
                -  Unemployed
                -  Self-Employed / Business Owner
                -  Government Employee
                -  Private Sector Employee
                -  Teacher / Educator
                -  Healthcare Professional (Doctor, Nurse, etc.)
                -  Engineer
                -  IT / Software Professional
                -  Accountant / Finance Professional
                -  Lawyer / Legal Professional
                -  Sales / Marketing Professional
                -  Consultant
                -  Homemaker
                -  Retired
                -  Freelancer
                -  Other
        5. What kind of job would you like to do in the future?
                - employee
                - freelance
                - I want to build my own business and ideas
                - I am not sure yet    

    - **If Non-German:**
        - What is the nearest city to your current location: **Country**, **City** (One primary) and two secondary 
         **If GWC city selected**
            at moment it is unclear
        - **If no GWC city is selected** 
          Then we will meet in person to get know each other:**



### Core Server Functions and Identities

    P1.  Profile (Memeber, Partner, Merchant, Influencer)
    P1.  Thread
    P1.  Events
    P1.  Influence Affiliate (Special private link for onboarding process)
    P2.  Benifits/Offers
    P2.  Marketplace
    P3.  Financial Service/Wealth
    P3.  Travel