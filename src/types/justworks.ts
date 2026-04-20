/** Justworks API response types */

export interface JustworksEmail {
  type: "WORK" | "PERSONAL";
  address: string;
}

export interface JustworksPhone {
  type: "WORK" | "PERSONAL" | "MOBILE";
  number: string;
}

export interface JustworksMember {
  id: string;
  given_name: string;
  family_name: string;
  preferred_name?: string;
  emails: JustworksEmail[];
  phones: JustworksPhone[];
  job_title?: string;
  department?: {
    id: string;
    name: string;
  };
  manager?: {
    id: string;
  };
  office?: string;
  employment_start_date: string;
  employment_end_date?: string;
  employment_status: "ACTIVE" | "TERMINATED" | "ON_LEAVE";
}

export interface JustworksTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

export interface JustworksListResponse<T> {
  data: T[];
  pagination: {
    next_cursor?: string;
  };
}
