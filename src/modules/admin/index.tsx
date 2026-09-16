// Company Administration module (design §7.21): ModuleShell sub-nav → 18 sub-pages, each permission-gated.
import type { ModuleProps } from '../registry';
import { useSession } from '../../store';
import { ModuleShell } from '../../components/ui';
import { ADMIN_PERMS, adminNav } from '../subnav';
import { Gate } from './shared';
import CompanyProfile from './CompanyProfile';
import Companies from './Companies';
import Branches from './Branches';
import Periods from './Periods';
import Defaults from './Defaults';
import Users from './Users';
import UserDetail from './UserDetail';
import Roles from './Roles';
import Numbering from './Numbering';
import VoucherTypes from './VoucherTypes';
import Workflows from './Workflows';
import Templates from './Templates';
import BusinessProfile from './BusinessProfile';
import Localization from './Localization';
import PlanUsage from './Plan';
import AuditLog from './AuditLog';
import Integrations from './Integrations';
import Jobs from './Jobs';
import Notifications from './Notifications';
import DataDemo from './DataDemo';


export default function Module({ route }: ModuleProps) {
  const s = useSession();
  const items = adminNav(s);
  return (
    <ModuleShell module="admin" title="Company administration" items={items} defaultSub={items.find((i) => !i.hidden)?.id ?? 'company'}>
      {(sub) => {
        const perm = ADMIN_PERMS[sub] ?? 'admin.company.view';
        const what = items.find((i) => i.id === sub)?.label ?? 'this page';
        const body = (() => {
          switch (sub) {
            case 'company': return <CompanyProfile />;
            case 'companies': return <Companies />;
            case 'branches': return <Branches />;
            case 'periods': return <Periods initialPeriod={route.params.period} />;
            case 'defaults': return <Defaults />;
            case 'profile': return <BusinessProfile />;
            case 'users': return route.id ? <UserDetail id={route.id} /> : <Users />;
            case 'roles': return <Roles id={route.id || undefined} />;
            case 'numbering': return <Numbering />;
            case 'voucher-types': return <VoucherTypes />;
            case 'workflows': return <Workflows />;
            case 'templates': return <Templates />;
            case 'localization': return <Localization />;
            case 'plan': return <PlanUsage />;
            case 'integrations': return <Integrations initialTab={route.params.tab} />;
            case 'audit': return <AuditLog />;
            case 'jobs': return <Jobs initialTab={route.params.tab} />;
            case 'notifications': return <Notifications />;
            case 'data': return <DataDemo />;
            default: return <CompanyProfile />;
          }
        })();
        if (sub === 'users' && route.id === s.user?.id) return body; // own profile always accessible
        return <Gate perm={perm} what={what}>{body}</Gate>;
      }}
    </ModuleShell>
  );
}
