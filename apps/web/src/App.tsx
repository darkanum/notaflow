import { AdminPage } from './pages/AdminPage';
import { EmittersPage } from './pages/EmittersPage';
import { HomePage } from './pages/HomePage';
import { InvoiceDetailPage } from './pages/InvoiceDetailPage';
import { InvoicesPage } from './pages/InvoicesPage';
import { IssuePage } from './pages/IssuePage';
import { MembersPage } from './pages/MembersPage';
import { useRoute } from './router';

export function App() {
  const route = useRoute();
  switch (route.name) {
    case 'emitters':
      return <EmittersPage accountId={route.accountId} />;
    case 'invoices':
      return <InvoicesPage accountId={route.accountId} />;
    case 'invoice':
      return <InvoiceDetailPage accountId={route.accountId} invoiceId={route.invoiceId} />;
    case 'issue':
      return <IssuePage accountId={route.accountId} invoiceId={route.invoiceId} />;
    case 'members':
      return <MembersPage accountId={route.accountId} />;
    case 'admin':
      return <AdminPage />;
    default:
      return <HomePage />;
  }
}
