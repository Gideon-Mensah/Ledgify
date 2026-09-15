import { Link } from 'react-router-dom';
import { useAuth } from '../store/AuthContext';
export default function PayrollJurisdictionRoute({children}){
 const auth=useAuth();
 if(auth.selectedOrganisation?.country_code==='GH')return <section className="jurisdiction-tax"><h1>Ghana payroll obligations</h1><p>PAYE and SSNIT are tracking only. A verified Ghana statutory payroll engine is not available.</p><Link to="/tax/settings">View tax registration and tracking</Link></section>;
 return children;
}
