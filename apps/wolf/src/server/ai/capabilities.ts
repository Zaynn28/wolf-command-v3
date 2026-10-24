/**
 * Capability mapping for the first assistant slice.
 *
 * The grants table only accepts owner_private and approve. These ids are not
 * grant types and are not written there.
 *
 * ai.chat and ai.read.organization follow organization module read for one
 * company. ai.read.cross_company stays unavailable: no existing grant covers
 * an assistant read across companies, and Owner Private is not that grant.
 * ai.execute.*, ai.manage.*, and ai.view.audit stay unavailable until the
 * access-policy UI can store them.
 */
export const assistantCapabilityIds = [
  "ai.chat",
  "ai.read.organization",
  "ai.read.cross_company",
  "ai.read.finance",
  "ai.read.hr",
  "ai.execute.organization.create_task",
  "ai.execute.organization.assign_task",
  "ai.manage.access",
  "ai.view.audit",
] as const;

export type AssistantCapabilityId = (typeof assistantCapabilityIds)[number];

export type AssistantCapability = {
  id: AssistantCapabilityId;
  status: "granted" | "denied" | "unavailable";
  mappedTo: string;
  note: string;
};

export function describeCapabilities(organizationRead: boolean): AssistantCapability[] {
  const organization = organizationRead ? "granted" : "denied";
  return [
    {
      id: "ai.chat",
      status: organization,
      mappedTo: "organization.read",
      note: "Mapped to organization module read for the selected company.",
    },
    {
      id: "ai.read.organization",
      status: organization,
      mappedTo: "organization.read",
      note: "Mapped to organization module read for the selected company.",
    },
    {
      id: "ai.read.cross_company",
      status: "unavailable",
      mappedTo: "none",
      note: "No existing grant covers cross-company assistant reads.",
    },
    {
      id: "ai.read.finance",
      status: "unavailable",
      mappedTo: "none",
      note: "Finance is not connected to the assistant.",
    },
    {
      id: "ai.read.hr",
      status: "unavailable",
      mappedTo: "none",
      note: "HR is not connected to the assistant.",
    },
    {
      id: "ai.execute.organization.create_task",
      status: "unavailable",
      mappedTo: "none",
      note: "Task creation stays unavailable until confirmation is bound to the exact change.",
    },
    {
      id: "ai.execute.organization.assign_task",
      status: "unavailable",
      mappedTo: "none",
      note: "Task assignment stays unavailable until confirmation is bound to the exact change.",
    },
    {
      id: "ai.manage.access",
      status: "unavailable",
      mappedTo: "none",
      note: "Assistant access management is not stored yet.",
    },
    {
      id: "ai.view.audit",
      status: "unavailable",
      mappedTo: "none",
      note: "Assistant audit review is not stored yet.",
    },
  ];
}
