# Module access

Authentication identifies the session. Membership decides which companies and departments that session belongs to. Authorization decides which module action is allowed. Approval is a separate grant from reading or editing.

The matrix is deny by default. A signed-in account with no matching membership, role, or grant is denied. Navigation links stay visible and are not the access check. `packages/shared` still makes the membership and grant decision. This matrix can only narrow that decision.

| Module | Scope | Read | Create | Update | Delete | Approve |
| --- | --- | --- | --- | --- | --- | --- |
| Overview | Company | Any active membership in that company | None | None | None | None |
| Finance | Department `finance` or ending in `-finance` | Membership covering that department | Same as read | Same as read | Administrator or owner membership covering it | Explicit approve grant |
| HR | Department `hr` or ending in `-hr` | Membership covering that department | Same as read | Same as read | Administrator or owner membership covering it | Explicit approve grant |
| Academy | Company | Any active membership in that company, including a department membership | Administrator or owner membership | Same as create | Same as create | Explicit approve grant |
| Content Machine | Department `content` or ending in `-content` | Membership covering that department | Same as read | Same as read | Administrator or owner membership covering it | Explicit approve grant |
| Owner Private | Explicit grant | `{ type: "owner_private", companyId }` for that company | None | None | None | Explicit approve grant whose scope is `owner_private` |
| Settings | Signed-in account | The session's own profile | None | None | None | None |

A company-wide membership has `departmentId` null and covers every department in that company. A department membership covers only that department. Asking for another company or department is denied. The page does not switch to a different company.

Administrator and owner memberships do not grant Owner Private. A missing Owner Private grant has no fallback. The Owner Private access grant does not approve anything, and the application does not allow Owner Private writes.

Approval of a department record requires an approve grant for that department, or a company approve grant. A department approve grant does not approve a company-wide request. Reading or editing does not approve.

Settings shows the signed-in email and the password-change form. It does not list other accounts. Provisioning accounts requires an administrator membership in the target company. An owner membership does not provision accounts. The local provisioning command remains an operator tool and is not an application route.

A temporary password must be changed before any module, including Settings, returns records. Password change and account disable invalidate the sessions already enforced by the session store.

No module has a database table of business records. Companies and departments are the shared tenant boundary documented in `docs/data-foundation.md`. The data-access layer returns an empty record list in the application. Tests pass fixture rows through that layer and check that company and department filters remove them. Denied responses omit records.
