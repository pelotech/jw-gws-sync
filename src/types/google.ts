/** Google Directory API types */

export interface GooglePhone {
  value: string;
  type: "work" | "home" | "mobile";
}

export interface GoogleOrganization {
  title?: string;
  department?: string;
  primary: boolean;
}

export interface GoogleExternalId {
  type: "organization";
  customType: "justworks_id";
  value: string;
}

export interface GoogleRelation {
  value: string;
  type: "manager";
}

export interface GoogleUser {
  primaryEmail: string;
  name: {
    givenName: string;
    familyName: string;
  };
  suspended: boolean;
  orgUnitPath: string;
  phones?: GooglePhone[];
  organizations?: GoogleOrganization[];
  externalIds?: GoogleExternalId[];
  relations?: GoogleRelation[];
}

export interface CreateUserPayload {
  primaryEmail: string;
  name: {
    givenName: string;
    familyName: string;
  };
  password: string;
  changePasswordAtNextLogin: boolean;
  orgUnitPath: string;
  phones?: GooglePhone[];
  organizations?: GoogleOrganization[];
  externalIds?: GoogleExternalId[];
}

export interface UpdateUserPayload {
  name?: {
    givenName: string;
    familyName: string;
  };
  phones?: GooglePhone[];
  organizations?: GoogleOrganization[];
  orgUnitPath?: string;
  suspended?: boolean;
}

export interface GoogleGroup {
  email: string;
  name: string;
  description?: string;
  id?: string;
}

export interface GoogleGroupMember {
  email: string;
  role: "MEMBER" | "OWNER" | "MANAGER";
  type: "USER";
}

export interface GoogleListResponse<T> {
  members?: T[];
  users?: T[];
  groups?: T[];
  nextPageToken?: string;
}
