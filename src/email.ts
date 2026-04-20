/** Email resolution for Justworks members */

import type { GoogleWorkspaceClient } from "./clients/google.ts";
import type { JustworksMember } from "./types/justworks.ts";

export type Logger = {
  info: (msg: string, data?: Record<string, unknown>) => void;
  warn: (msg: string, data?: Record<string, unknown>) => void;
  error: (msg: string, data?: Record<string, unknown>) => void;
};

export class EmailGenerator {
  private batchCache: Set<string> = new Set();

  constructor(
    private domain: string,
    private gws: GoogleWorkspaceClient,
    private logger: Logger,
  ) {}

  /** Reset cache between sync runs. */
  resetBatchCache(): void {
    this.batchCache.clear();
  }

  /**
   * Normalize a name part for email generation.
   * Lowercase, strip diacritics, replace spaces/hyphens with dots,
   * remove non-alphanumeric chars (except dots).
   */
  static normalize(name: string): string {
    return name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // strip diacritics
      .toLowerCase()
      .replace(/[\s-]+/g, ".") // spaces/hyphens → dots
      .replace(/[^a-z0-9.]/g, "") // remove non-alphanumeric except dots
      .replace(/\.{2,}/g, ".") // collapse multiple dots
      .replace(/^\.+|\.+$/g, ""); // trim leading/trailing dots
  }

  /**
   * Resolve the primary email for a Justworks member.
   *
   * 1. Check JW member's emails for WORK type matching domain -> use it
   * 2. Otherwise generate: normalize(givenName).normalize(familyName)@domain
   * 3. Check Google Workspace + batchCache for conflicts
   * 4. On conflict: try firstname.m.lastname (middle initial from preferred_name)
   * 5. Still conflict: append numbers: firstname.lastname2, firstname.lastname3
   * 6. Add resolved email to batchCache
   */
  async resolveEmail(member: JustworksMember): Promise<string> {
    // Step 1: Check for existing work email at our domain
    const workEmail = member.emails.find(
      (e) =>
        e.type === "WORK" &&
        e.address.toLowerCase().endsWith(`@${this.domain.toLowerCase()}`),
    );
    if (workEmail) {
      const email = workEmail.address.toLowerCase();
      this.batchCache.add(email);
      this.logger.info("Using existing work email", {
        memberId: member.id,
        email,
      });
      return email;
    }

    // Step 2: Generate from name
    const firstName = EmailGenerator.normalize(member.given_name);
    const lastName = EmailGenerator.normalize(member.family_name);
    const baseLocal = `${firstName}.${lastName}`;
    const baseEmail = `${baseLocal}@${this.domain}`;

    // Step 3: Check for conflicts
    if (!(await this.isConflict(baseEmail))) {
      this.batchCache.add(baseEmail);
      this.logger.info("Resolved email from name", {
        memberId: member.id,
        email: baseEmail,
      });
      return baseEmail;
    }

    // Step 4: Try with middle initial if preferred_name provides one
    if (member.preferred_name) {
      const parts = member.preferred_name.trim().split(/\s+/);
      if (parts.length >= 2) {
        // Look for a middle initial — a single character part in the middle
        const middleParts = parts.slice(1, -1);
        for (const part of middleParts) {
          const initial = part.replace(/\./g, "").toLowerCase();
          if (initial.length === 1) {
            const middleEmail =
              `${firstName}.${initial}.${lastName}@${this.domain}`;
            if (!(await this.isConflict(middleEmail))) {
              this.batchCache.add(middleEmail);
              this.logger.info("Resolved email with middle initial", {
                memberId: member.id,
                email: middleEmail,
              });
              return middleEmail;
            }
          }
        }
      }
    }

    // Step 5: Append numbers
    let counter = 2;
    while (true) {
      const numberedEmail = `${baseLocal}${counter}@${this.domain}`;
      if (!(await this.isConflict(numberedEmail))) {
        this.batchCache.add(numberedEmail);
        this.logger.info("Resolved email with number suffix", {
          memberId: member.id,
          email: numberedEmail,
          counter,
        });
        return numberedEmail;
      }
      counter++;
      // Safety valve
      if (counter > 100) {
        throw new Error(
          `Unable to resolve unique email for member ${member.id} after 100 attempts`,
        );
      }
    }
  }

  /** Check if an email conflicts with existing Google users or batch cache. */
  private async isConflict(email: string): Promise<boolean> {
    if (this.batchCache.has(email)) {
      return true;
    }
    const existing = await this.gws.getUser(email);
    return existing !== null;
  }
}
