export type Authority = {
  name: string;
  dept: string;
  contact: string;
  helpline?: string;
};

type CityEntry = { match: string[]; authority: Authority };

// Civic bodies responsible for road / sanitation / drainage complaints in India.
const CITY_AUTHORITIES: CityEntry[] = [
  {
    match: ["mumbai", "brihanmumbai", "navi mumbai", "thane"],
    authority: {
      name: "Brihanmumbai Municipal Corporation (BMC)",
      dept: "Roads & Traffic Department",
      contact: "https://portal.mcgm.gov.in",
      helpline: "1916",
    },
  },
  {
    match: ["delhi", "new delhi", "north delhi", "south delhi"],
    authority: {
      name: "Municipal Corporation of Delhi (MCD)",
      dept: "Public Works / Sanitation",
      contact: "https://mcdonline.nic.in",
      helpline: "155305",
    },
  },
  {
    match: ["bengaluru", "bangalore"],
    authority: {
      name: "Bruhat Bengaluru Mahanagara Palike (BBMP)",
      dept: "Road Infrastructure Wing",
      contact: "https://bbmp.gov.in",
      helpline: "1533",
    },
  },
  {
    match: ["hyderabad", "secunderabad", "cyberabad"],
    authority: {
      name: "Greater Hyderabad Municipal Corporation (GHMC)",
      dept: "Engineering Wing",
      contact: "https://www.ghmc.gov.in",
      helpline: "040-21111111",
    },
  },
  {
    match: ["chennai", "madras"],
    authority: {
      name: "Greater Chennai Corporation (GCC)",
      dept: "Bus Route Roads Department",
      contact: "https://chennaicorporation.gov.in",
      helpline: "1913",
    },
  },
  {
    match: ["kolkata", "calcutta", "howrah"],
    authority: {
      name: "Kolkata Municipal Corporation (KMC)",
      dept: "Roads & Drainage Department",
      contact: "https://www.kmcgov.in",
      helpline: "18003453375",
    },
  },
  {
    match: ["pune", "pimpri", "chinchwad"],
    authority: {
      name: "Pune Municipal Corporation (PMC)",
      dept: "Road Department",
      contact: "https://pmc.gov.in",
      helpline: "1800-1030-222",
    },
  },
  {
    match: ["ahmedabad", "gandhinagar"],
    authority: {
      name: "Ahmedabad Municipal Corporation (AMC)",
      dept: "Roads & Buildings",
      contact: "https://ahmedabadcity.gov.in",
      helpline: "155303",
    },
  },
  {
    match: ["jaipur"],
    authority: {
      name: "Jaipur Municipal Corporation (JMC)",
      dept: "Engineering Department",
      contact: "https://jaipurmc.org",
      helpline: "0141-2742826",
    },
  },
  {
    match: ["lucknow"],
    authority: {
      name: "Lucknow Nagar Nigam",
      dept: "Engineering & Sanitation",
      contact: "https://lmc.up.nic.in",
      helpline: "1533",
    },
  },
  {
    match: ["patna"],
    authority: {
      name: "Patna Municipal Corporation (PMC)",
      dept: "Roads & Drainage",
      contact: "https://www.pmc.bihar.gov.in",
      helpline: "155304",
    },
  },
  {
    match: ["bhopal", "indore"],
    authority: {
      name: "Madhya Pradesh Urban Local Body",
      dept: "Nagar Nigam Engineering Wing",
      contact: "https://mpurban.gov.in",
      helpline: "155304",
    },
  },
  {
    match: ["kochi", "ernakulam", "thiruvananthapuram", "kozhikode"],
    authority: {
      name: "Kerala Urban Local Body",
      dept: "Municipal Engineering Wing",
      contact: "https://lsgkerala.gov.in",
      helpline: "1800-425-1912",
    },
  },
  {
    match: ["guwahati"],
    authority: {
      name: "Guwahati Municipal Corporation (GMC)",
      dept: "Engineering Department",
      contact: "https://www.gmcportal.in",
      helpline: "1800-345-3574",
    },
  },
  {
    match: ["chandigarh", "mohali", "panchkula"],
    authority: {
      name: "Municipal Corporation Chandigarh",
      dept: "Roads Wing",
      contact: "https://mcchandigarh.gov.in",
      helpline: "0172-2541003",
    },
  },
];

const STATE_PWD: Record<string, string> = {
  maharashtra: "Maharashtra PWD",
  delhi: "Delhi PWD",
  karnataka: "Karnataka PWD",
  telangana: "Telangana R&B Department",
  "tamil nadu": "Tamil Nadu Highways Department",
  "west bengal": "West Bengal PWD",
  gujarat: "Gujarat R&B Department",
  rajasthan: "Rajasthan PWD",
  "uttar pradesh": "Uttar Pradesh PWD",
  bihar: "Bihar Road Construction Department",
  "madhya pradesh": "Madhya Pradesh PWD",
  kerala: "Kerala PWD",
  assam: "Assam PWD",
  punjab: "Punjab PWD",
  haryana: "Haryana PWD",
  odisha: "Odisha Works Department",
  jharkhand: "Jharkhand Road Construction Department",
  chhattisgarh: "Chhattisgarh PWD",
  uttarakhand: "Uttarakhand PWD",
  goa: "Goa PWD",
};

const NHAI: Authority = {
  name: "National Highways Authority of India (NHAI)",
  dept: "Highway Maintenance / Rajmargyatra grievance cell",
  contact: "https://nhai.gov.in",
  helpline: "1033",
};

export function isNationalHighway(road?: string | null) {
  if (!road) return false;
  return /\b(nh|national highway|ne\d|expressway)\b/i.test(road);
}

export function resolveAuthority(input: {
  city?: string | null;
  state?: string | null;
  road?: string | null;
}): Authority {
  if (isNationalHighway(input.road)) return NHAI;

  const city = (input.city ?? "").toLowerCase();
  const found = CITY_AUTHORITIES.find((entry) => entry.match.some((m) => city.includes(m)));
  if (found) return found.authority;

  const state = (input.state ?? "").toLowerCase().trim();
  const pwd = Object.keys(STATE_PWD).find((s) => state.includes(s));
  if (pwd) {
    return {
      name: STATE_PWD[pwd]!,
      dept: "Public Works Department — road maintenance",
      contact: "https://cpgrams.gov.in",
      helpline: "1533",
    };
  }

  return {
    name: "Local Urban Local Body (Nagar Nigam / Panchayat)",
    dept: "Public grievance cell",
    contact: "https://cpgrams.gov.in",
    helpline: "1533",
  };
}

export const HAZARD_LABELS: Record<string, string> = {
  pothole: "Pothole",
  waterlogging: "Waterlogging",
  garbage: "Garbage",
  person: "Person",
  phone: "Phone",
  debris: "Construction debris",
  open_manhole: "Open manhole / drain",
  broken_footpath: "Broken footpath",
  damaged_road: "Damaged road surface",
  traffic_hazard: "Traffic hazard",
  stagnant_water: "Stagnant water (mosquito risk)",
  other: "Other urban risk",
};

export function severityColor(severity: string) {
  switch (severity) {
    case "critical":
      return "#dc2626";
    case "high":
      return "#f97316";
    case "medium":
      return "#eab308";
    default:
      return "#22c55e";
  }
}

export function severityFromScore(score: number) {
  if (score >= 75) return "critical";
  if (score >= 50) return "high";
  if (score >= 25) return "medium";
  return "low";
}
