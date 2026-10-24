import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { authorize, reasonCode, type Actor, type ResourceScope } from "./authorization.ts";

const company = "company-amg";
const otherCompany = "company-other";
const finance = "department-finance";
const hr = "department-hr";

const companyResource: ResourceScope = { kind: "company", companyId: company };
const financeResource: ResourceScope = {
  kind: "department",
  companyId: company,
  departmentId: finance,
};
const hrResource: ResourceScope = {
  kind: "department",
  companyId: company,
  departmentId: hr,
};
const ownerPrivateResource: ResourceScope = {
  kind: "owner_private",
  companyId: company,
};

function actor(overrides: Partial<Actor> = {}): Actor {
  return {
    userId: "user-1",
    memberships: [],
    grants: [],
    ...overrides,
  };
}

describe("missing actor", () => {
  it("denies a null actor", () => {
    const decision = authorize({
      actor: null,
      action: "read",
      resource: companyResource,
    });

    assert.equal(decision.outcome, "deny");
    assert.equal(decision.reason.code, reasonCode.missingActor);
    assert.equal(decision.actorId, null);
  });

  it("denies an actor without a user id", () => {
    const decision = authorize({
      actor: actor({ userId: "  " }),
      action: "read",
      resource: companyResource,
    });

    assert.equal(decision.outcome, "deny");
    assert.equal(decision.reason.code, reasonCode.missingActor);
  });

  it("denies an actor whose memberships were not supplied", () => {
    const decision = authorize({
      actor: { userId: "user-1", grants: [] } as unknown as Actor,
      action: "read",
      resource: companyResource,
    });

    assert.equal(decision.outcome, "deny");
    assert.equal(decision.reason.code, reasonCode.missingActor);
  });
});

describe("Owner Private isolation", () => {
  it("denies staff reading Owner Private", () => {
    const decision = authorize({
      actor: actor({
        memberships: [{ companyId: company, departmentId: finance, role: "staff" }],
      }),
      action: "read",
      resource: ownerPrivateResource,
    });

    assert.equal(decision.outcome, "deny");
    assert.equal(decision.reason.code, reasonCode.ownerPrivateGrantRequired);
  });

  it("denies an ordinary administrator reading Owner Private", () => {
    const decision = authorize({
      actor: actor({
        memberships: [{ companyId: company, departmentId: null, role: "administrator" }],
      }),
      action: "read",
      resource: ownerPrivateResource,
    });

    assert.equal(decision.outcome, "deny");
    assert.equal(decision.reason.code, reasonCode.ownerPrivateGrantRequired);
  });

  it("does not infer Owner Private access from an owner role", () => {
    const decision = authorize({
      actor: actor({
        memberships: [{ companyId: company, departmentId: null, role: "owner" }],
      }),
      action: "read",
      resource: ownerPrivateResource,
    });

    assert.equal(decision.outcome, "deny");
    assert.equal(decision.reason.code, reasonCode.ownerPrivateGrantRequired);
  });

  it("allows Owner Private access only through an explicit grant", () => {
    const decision = authorize({
      actor: actor({
        memberships: [{ companyId: company, departmentId: finance, role: "staff" }],
        grants: [{ type: "owner_private", companyId: company }],
      }),
      action: "read",
      resource: ownerPrivateResource,
    });

    assert.equal(decision.outcome, "allow");
    assert.equal(decision.reason.code, reasonCode.explicitGrant);
    assert.equal(decision.actorId, "user-1");
  });

  it("does not let an Owner Private grant cross companies", () => {
    const decision = authorize({
      actor: actor({
        grants: [{ type: "owner_private", companyId: otherCompany }],
      }),
      action: "read",
      resource: ownerPrivateResource,
    });

    assert.equal(decision.outcome, "deny");
    assert.equal(decision.reason.code, reasonCode.ownerPrivateGrantRequired);
  });
});

describe("company and department boundaries", () => {
  it("denies a user from another company", () => {
    const decision = authorize({
      actor: actor({
        memberships: [{ companyId: otherCompany, departmentId: null, role: "administrator" }],
      }),
      action: "read",
      resource: financeResource,
    });

    assert.equal(decision.outcome, "deny");
    assert.equal(decision.reason.code, reasonCode.wrongCompany);
  });

  it("denies a user outside the permitted department", () => {
    const decision = authorize({
      actor: actor({
        memberships: [{ companyId: company, departmentId: finance, role: "staff" }],
      }),
      action: "read",
      resource: hrResource,
    });

    assert.equal(decision.outcome, "deny");
    assert.equal(decision.reason.code, reasonCode.outsideDepartment);
  });

  it("allows a department member to read that department", () => {
    const decision = authorize({
      actor: actor({
        memberships: [{ companyId: company, departmentId: finance, role: "staff" }],
      }),
      action: "read",
      resource: financeResource,
    });

    assert.equal(decision.outcome, "allow");
    assert.equal(decision.reason.code, reasonCode.membership);
  });

  it("allows a company-wide administrator to read another department", () => {
    const decision = authorize({
      actor: actor({
        memberships: [{ companyId: company, departmentId: null, role: "administrator" }],
      }),
      action: "update",
      resource: hrResource,
    });

    assert.equal(decision.outcome, "allow");
    assert.equal(decision.reason.code, reasonCode.membership);
  });

  it("allows membership actions on a company record", () => {
    for (const action of ["read", "create", "update", "delete"] as const) {
      const decision = authorize({
        actor: actor({
          memberships: [{ companyId: company, departmentId: finance, role: "staff" }],
        }),
        action,
        resource: companyResource,
      });

      assert.equal(decision.outcome, "allow", action);
      assert.equal(decision.reason.code, reasonCode.membership);
    }
  });
});

describe("approval", () => {
  it("denies approval when the user can only view or edit", () => {
    const decision = authorize({
      actor: actor({
        memberships: [{ companyId: company, departmentId: null, role: "administrator" }],
      }),
      action: "approve",
      resource: financeResource,
    });

    assert.equal(decision.outcome, "deny");
    assert.equal(decision.reason.code, reasonCode.approvalGrantRequired);
  });

  it("allows approval when an explicit department grant matches", () => {
    const decision = authorize({
      actor: actor({
        grants: [
          {
            type: "approve",
            companyId: company,
            scope: "department",
            departmentId: finance,
          },
        ],
      }),
      action: "approve",
      resource: financeResource,
    });

    assert.equal(decision.outcome, "allow");
    assert.equal(decision.reason.code, reasonCode.explicitGrant);
  });

  it("does not let a department approval grant cover another department", () => {
    const decision = authorize({
      actor: actor({
        memberships: [{ companyId: company, departmentId: null, role: "administrator" }],
        grants: [
          {
            type: "approve",
            companyId: company,
            scope: "department",
            departmentId: finance,
          },
        ],
      }),
      action: "approve",
      resource: hrResource,
    });

    assert.equal(decision.outcome, "deny");
    assert.equal(decision.reason.code, reasonCode.approvalGrantRequired);
  });

  it("does not let an Owner Private access grant approve those records", () => {
    const decision = authorize({
      actor: actor({
        grants: [{ type: "owner_private", companyId: company }],
      }),
      action: "approve",
      resource: ownerPrivateResource,
    });

    assert.equal(decision.outcome, "deny");
    assert.equal(decision.reason.code, reasonCode.approvalGrantRequired);
  });

  it("allows Owner Private approval only through an explicit approval grant", () => {
    const decision = authorize({
      actor: actor({
        grants: [
          {
            type: "approve",
            companyId: company,
            scope: "owner_private",
            departmentId: null,
          },
        ],
      }),
      action: "approve",
      resource: ownerPrivateResource,
    });

    assert.equal(decision.outcome, "allow");
    assert.equal(decision.reason.code, reasonCode.explicitGrant);
  });

  it("does not let a company approval grant cover Owner Private", () => {
    const decision = authorize({
      actor: actor({
        memberships: [{ companyId: company, departmentId: null, role: "owner" }],
        grants: [
          {
            type: "approve",
            companyId: company,
            scope: "company",
            departmentId: null,
          },
        ],
      }),
      action: "approve",
      resource: ownerPrivateResource,
    });

    assert.equal(decision.outcome, "deny");
    assert.equal(decision.reason.code, reasonCode.approvalGrantRequired);
  });
});

describe("unknown actions and malformed scopes", () => {
  it("denies an unknown action", () => {
    const decision = authorize({
      actor: actor({
        memberships: [{ companyId: company, departmentId: null, role: "owner" }],
      }),
      action: "archive",
      resource: companyResource,
    });

    assert.equal(decision.outcome, "deny");
    assert.equal(decision.reason.code, reasonCode.unknownAction);
  });

  it("denies a missing resource", () => {
    const decision = authorize({
      actor: actor(),
      action: "read",
      resource: null,
    });

    assert.equal(decision.outcome, "deny");
    assert.equal(decision.reason.code, reasonCode.malformedScope);
    assert.equal(decision.resource, null);
  });

  it("denies a department scope without a department id", () => {
    const decision = authorize({
      actor: actor(),
      action: "read",
      resource: { kind: "department", companyId: company },
    });

    assert.equal(decision.outcome, "deny");
    assert.equal(decision.reason.code, reasonCode.malformedScope);
  });

  it("denies an unsupported scope kind", () => {
    const decision = authorize({
      actor: actor(),
      action: "read",
      resource: { kind: "global", companyId: company },
    });

    assert.equal(decision.outcome, "deny");
    assert.equal(decision.reason.code, reasonCode.malformedScope);
  });

  it("denies a blank company id", () => {
    const decision = authorize({
      actor: actor(),
      action: "delete",
      resource: { kind: "company", companyId: "" },
    });

    assert.equal(decision.outcome, "deny");
    assert.equal(decision.reason.code, reasonCode.malformedScope);
  });
});
