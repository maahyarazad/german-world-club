-- Onboarding Phase 2: Profiling (feature 013, specs/013-onboarding-profiling).
--
-- Mandatory, gated the same way Phase 1 approval already is: a member with
-- membership_applications.state = 'approved' and no completed row here is
-- refused every ordinary member route until profiling is done
-- (server/src/plugins/10-auth.ts). country_of_residence (020_onboarding.sql)
-- decides the branch once, at first answer, and it is never recomputed.

-- ---------------------------------------------------------------------------
-- Designated club cities
-- ---------------------------------------------------------------------------

-- Maintained independently of any member's submission (research R4): a
-- non-German applicant's nearest city is checked against this list, not the
-- other way around, so the list can grow without touching past submissions.
CREATE TABLE IF NOT EXISTS gwc_cities (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  country    char(2)     NOT NULL,
  city       text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT gwc_cities_country_is_iso CHECK (country ~ '^[A-Z]{2}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS gwc_cities_country_city_unique ON gwc_cities (country, lower(city));

-- Starting set: the main cities of Germany and of the rest of the world.
-- Staff maintain this by hand until a management UI is requested (spec.md
-- Assumptions); ON CONFLICT makes the seed idempotent.
INSERT INTO gwc_cities (country, city) VALUES
  ('DE', 'Berlin'),
  ('DE', 'Hamburg'),
  ('DE', 'Munich'),
  ('DE', 'Cologne'),
  ('DE', 'Frankfurt am Main'),
  ('DE', 'Stuttgart'),
  ('DE', 'Düsseldorf'),
  ('DE', 'Leipzig'),
  ('DE', 'Dortmund'),
  ('DE', 'Essen'),
  ('DE', 'Bremen'),
  ('DE', 'Dresden'),
  ('DE', 'Hanover'),
  ('DE', 'Nuremberg'),
  ('DE', 'Duisburg'),
  ('DE', 'Bochum'),
  ('DE', 'Wuppertal'),
  ('DE', 'Bielefeld'),
  ('DE', 'Bonn'),
  ('DE', 'Münster'),
  ('DE', 'Karlsruhe'),
  ('DE', 'Mannheim'),
  ('DE', 'Augsburg'),
  ('DE', 'Wiesbaden'),
  ('DE', 'Mönchengladbach'),
  ('DE', 'Gelsenkirchen'),
  ('DE', 'Aachen'),
  ('DE', 'Braunschweig'),
  ('DE', 'Kiel'),
  ('DE', 'Chemnitz'),
  ('DE', 'Halle (Saale)'),
  ('DE', 'Magdeburg'),
  ('DE', 'Freiburg im Breisgau'),
  ('DE', 'Krefeld'),
  ('DE', 'Mainz'),
  ('DE', 'Lübeck'),
  ('DE', 'Erfurt'),
  ('DE', 'Rostock'),
  ('DE', 'Kassel'),
  ('DE', 'Hagen'),
  ('DE', 'Potsdam'),
  ('DE', 'Saarbrücken'),
  ('DE', 'Oldenburg'),
  ('DE', 'Osnabrück'),
  ('DE', 'Heidelberg'),
  ('DE', 'Darmstadt'),
  ('DE', 'Regensburg'),
  ('DE', 'Ingolstadt'),
  ('DE', 'Würzburg'),
  ('DE', 'Wolfsburg'),
  ('DE', 'Ulm'),
  ('DE', 'Göttingen'),
  ('DE', 'Jena'),
  ('DE', 'Trier'),
  ('DE', 'Koblenz'),
  ('DE', 'Bremerhaven'),
  ('DE', 'Paderborn'),
  ('AE', 'Dubai'),
  ('AE', 'Abu Dhabi'),
  ('AE', 'Sharjah'),
  ('US', 'New York'),
  ('US', 'Los Angeles'),
  ('US', 'Chicago'),
  ('US', 'Houston'),
  ('US', 'San Francisco'),
  ('US', 'Washington'),
  ('US', 'Boston'),
  ('US', 'Seattle'),
  ('US', 'Miami'),
  ('US', 'Atlanta'),
  ('US', 'Dallas'),
  ('US', 'Philadelphia'),
  ('US', 'San Diego'),
  ('US', 'Denver'),
  ('US', 'Austin'),
  ('US', 'Phoenix'),
  ('US', 'Las Vegas'),
  ('US', 'Detroit'),
  ('CA', 'Toronto'),
  ('CA', 'Montreal'),
  ('CA', 'Vancouver'),
  ('CA', 'Calgary'),
  ('CA', 'Ottawa'),
  ('CA', 'Edmonton'),
  ('MX', 'Mexico City'),
  ('MX', 'Guadalajara'),
  ('MX', 'Monterrey'),
  ('BR', 'São Paulo'),
  ('BR', 'Rio de Janeiro'),
  ('BR', 'Brasília'),
  ('BR', 'Salvador'),
  ('AR', 'Buenos Aires'),
  ('AR', 'Córdoba'),
  ('CL', 'Santiago'),
  ('CO', 'Bogotá'),
  ('CO', 'Medellín'),
  ('PE', 'Lima'),
  ('GB', 'London'),
  ('GB', 'Manchester'),
  ('GB', 'Birmingham'),
  ('GB', 'Edinburgh'),
  ('GB', 'Glasgow'),
  ('GB', 'Liverpool'),
  ('GB', 'Leeds'),
  ('GB', 'Bristol'),
  ('IE', 'Dublin'),
  ('FR', 'Paris'),
  ('FR', 'Marseille'),
  ('FR', 'Lyon'),
  ('FR', 'Toulouse'),
  ('FR', 'Nice'),
  ('FR', 'Strasbourg'),
  ('ES', 'Madrid'),
  ('ES', 'Barcelona'),
  ('ES', 'Valencia'),
  ('ES', 'Seville'),
  ('PT', 'Lisbon'),
  ('PT', 'Porto'),
  ('IT', 'Rome'),
  ('IT', 'Milan'),
  ('IT', 'Naples'),
  ('IT', 'Turin'),
  ('IT', 'Florence'),
  ('NL', 'Amsterdam'),
  ('NL', 'Rotterdam'),
  ('NL', 'The Hague'),
  ('NL', 'Utrecht'),
  ('BE', 'Brussels'),
  ('BE', 'Antwerp'),
  ('LU', 'Luxembourg'),
  ('CH', 'Zurich'),
  ('CH', 'Geneva'),
  ('CH', 'Basel'),
  ('CH', 'Bern'),
  ('AT', 'Vienna'),
  ('AT', 'Salzburg'),
  ('AT', 'Graz'),
  ('AT', 'Innsbruck'),
  ('DK', 'Copenhagen'),
  ('SE', 'Stockholm'),
  ('SE', 'Gothenburg'),
  ('NO', 'Oslo'),
  ('FI', 'Helsinki'),
  ('IS', 'Reykjavik'),
  ('PL', 'Warsaw'),
  ('PL', 'Kraków'),
  ('PL', 'Wrocław'),
  ('PL', 'Gdańsk'),
  ('CZ', 'Prague'),
  ('CZ', 'Brno'),
  ('SK', 'Bratislava'),
  ('HU', 'Budapest'),
  ('RO', 'Bucharest'),
  ('RO', 'Cluj-Napoca'),
  ('BG', 'Sofia'),
  ('GR', 'Athens'),
  ('GR', 'Thessaloniki'),
  ('HR', 'Zagreb'),
  ('RS', 'Belgrade'),
  ('SI', 'Ljubljana'),
  ('EE', 'Tallinn'),
  ('LV', 'Riga'),
  ('LT', 'Vilnius'),
  ('UA', 'Kyiv'),
  ('TR', 'Istanbul'),
  ('TR', 'Ankara'),
  ('TR', 'Izmir'),
  ('RU', 'Moscow'),
  ('RU', 'Saint Petersburg'),
  ('GE', 'Tbilisi'),
  ('AM', 'Yerevan'),
  ('AZ', 'Baku'),
  ('IL', 'Tel Aviv'),
  ('IL', 'Jerusalem'),
  ('SA', 'Riyadh'),
  ('SA', 'Jeddah'),
  ('QA', 'Doha'),
  ('KW', 'Kuwait City'),
  ('BH', 'Manama'),
  ('OM', 'Muscat'),
  ('JO', 'Amman'),
  ('LB', 'Beirut'),
  ('EG', 'Cairo'),
  ('EG', 'Alexandria'),
  ('MA', 'Casablanca'),
  ('MA', 'Rabat'),
  ('DZ', 'Algiers'),
  ('TN', 'Tunis'),
  ('NG', 'Lagos'),
  ('NG', 'Abuja'),
  ('GH', 'Accra'),
  ('KE', 'Nairobi'),
  ('ET', 'Addis Ababa'),
  ('TZ', 'Dar es Salaam'),
  ('ZA', 'Johannesburg'),
  ('ZA', 'Cape Town'),
  ('ZA', 'Pretoria'),
  ('ZA', 'Durban'),
  ('IN', 'Mumbai'),
  ('IN', 'Delhi'),
  ('IN', 'Bangalore'),
  ('IN', 'Hyderabad'),
  ('IN', 'Chennai'),
  ('IN', 'Kolkata'),
  ('IN', 'Pune'),
  ('PK', 'Karachi'),
  ('PK', 'Lahore'),
  ('PK', 'Islamabad'),
  ('BD', 'Dhaka'),
  ('LK', 'Colombo'),
  ('NP', 'Kathmandu'),
  ('CN', 'Beijing'),
  ('CN', 'Shanghai'),
  ('CN', 'Shenzhen'),
  ('CN', 'Guangzhou'),
  ('CN', 'Hong Kong'),
  ('TW', 'Taipei'),
  ('JP', 'Tokyo'),
  ('JP', 'Osaka'),
  ('JP', 'Nagoya'),
  ('JP', 'Yokohama'),
  ('KR', 'Seoul'),
  ('KR', 'Busan'),
  ('SG', 'Singapore'),
  ('MY', 'Kuala Lumpur'),
  ('TH', 'Bangkok'),
  ('VN', 'Ho Chi Minh City'),
  ('VN', 'Hanoi'),
  ('ID', 'Jakarta'),
  ('ID', 'Surabaya'),
  ('PH', 'Manila'),
  ('KZ', 'Almaty'),
  ('KZ', 'Astana'),
  ('UZ', 'Tashkent'),
  ('AU', 'Sydney'),
  ('AU', 'Melbourne'),
  ('AU', 'Brisbane'),
  ('AU', 'Perth'),
  ('AU', 'Adelaide'),
  ('NZ', 'Auckland'),
  ('NZ', 'Wellington')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Profiling answers
-- ---------------------------------------------------------------------------

-- One row per member who has answered at least one question. Absence means
-- "not started" — branch is not known from this table alone until then; it is
-- computed on the fly from country_of_residence (see application/status.ts).
CREATE TABLE IF NOT EXISTS member_profiling (
  member_id   uuid        PRIMARY KEY REFERENCES members (id) ON DELETE RESTRICT,
  -- Frozen at the first answer. A later correction to country_of_residence
  -- must not retroactively change which questions "should have" applied.
  branch      text        NOT NULL,

  -- Germany branch (Q1–Q5).
  settling_status     text,
  languages            text[],
  qualification_level  text,
  occupation            text,
  desired_work_type    text,

  -- Elsewhere branch: one primary city, up to two secondary.
  primary_city_country     char(2),
  primary_city_name        text,
  secondary_city_1_country char(2),
  secondary_city_1_name    text,
  secondary_city_2_country char(2),
  secondary_city_2_name    text,
  matched_gwc_city_id      uuid REFERENCES gwc_cities (id) ON DELETE RESTRICT,
  outcome                  text,

  completed_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT member_profiling_branch CHECK (branch IN ('germany', 'elsewhere')),
  CONSTRAINT member_profiling_settling_status CHECK (settling_status IS NULL OR settling_status IN ('know_where', 'need_help')),
  CONSTRAINT member_profiling_qualification_level CHECK (qualification_level IS NULL OR qualification_level IN (
    'no_formal_qualification', 'secondary_school', 'diploma_certificate', 'associate_degree',
    'bachelors_degree', 'masters_degree', 'doctorate', 'professional_qualification'
  )),
  CONSTRAINT member_profiling_occupation CHECK (occupation IS NULL OR occupation IN (
    'student', 'unemployed', 'self_employed_business_owner', 'government_employee',
    'private_sector_employee', 'teacher_educator', 'healthcare_professional', 'engineer',
    'it_software_professional', 'accountant_finance_professional', 'lawyer_legal_professional',
    'sales_marketing_professional', 'consultant', 'homemaker', 'retired', 'freelancer', 'other'
  )),
  CONSTRAINT member_profiling_desired_work_type CHECK (desired_work_type IS NULL OR desired_work_type IN (
    'employee', 'freelance', 'own_business', 'not_sure'
  )),
  CONSTRAINT member_profiling_primary_city_country_is_iso CHECK (primary_city_country IS NULL OR primary_city_country ~ '^[A-Z]{2}$'),
  CONSTRAINT member_profiling_secondary_1_country_is_iso CHECK (secondary_city_1_country IS NULL OR secondary_city_1_country ~ '^[A-Z]{2}$'),
  CONSTRAINT member_profiling_secondary_2_country_is_iso CHECK (secondary_city_2_country IS NULL OR secondary_city_2_country ~ '^[A-Z]{2}$'),
  CONSTRAINT member_profiling_outcome CHECK (outcome IS NULL OR outcome IN ('in_person_meeting', 'gwc_city_match')),

  -- A row cannot carry the other branch's answers.
  CONSTRAINT member_profiling_germany_fields_only_in_germany_branch CHECK (
    branch = 'germany' OR (
      settling_status IS NULL AND languages IS NULL AND qualification_level IS NULL
      AND occupation IS NULL AND desired_work_type IS NULL
    )
  ),
  CONSTRAINT member_profiling_elsewhere_fields_only_in_elsewhere_branch CHECK (
    branch = 'elsewhere' OR (
      primary_city_country IS NULL AND primary_city_name IS NULL
      AND secondary_city_1_country IS NULL AND secondary_city_1_name IS NULL
      AND secondary_city_2_country IS NULL AND secondary_city_2_name IS NULL
      AND matched_gwc_city_id IS NULL AND outcome IS NULL
    )
  ),
  CONSTRAINT member_profiling_outcome_only_when_complete CHECK (outcome IS NULL OR completed_at IS NOT NULL),
  CONSTRAINT member_profiling_match_implies_gwc_outcome CHECK (
    (matched_gwc_city_id IS NULL) = (outcome IS DISTINCT FROM 'gwc_city_match')
  )
);

-- A decision is final, the same rule membership_applications_decision_is_final
-- enforces for Phase 1 (020_onboarding.sql): once complete, a member-facing
-- route cannot edit the row. Staff-side correction, if ever needed, is out of
-- scope for this feature and would need its own, explicit escape hatch.
CREATE OR REPLACE FUNCTION member_profiling_complete_is_final() RETURNS trigger AS $$
BEGIN
  IF OLD.completed_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'profiling for % is already complete', OLD.member_id;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS member_profiling_final ON member_profiling;
CREATE TRIGGER member_profiling_final BEFORE UPDATE ON member_profiling
  FOR EACH ROW EXECUTE FUNCTION member_profiling_complete_is_final();
