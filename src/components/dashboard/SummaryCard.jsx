// A financial figure with a clearly separated label, value and reporting context.
function SummaryCard({ title, value, change, changeType = 'neutral', icon: Icon }) {
  return <article className={`summary-card summary-card-${changeType}${String(value).length > 17 ? ' summary-card-wide' : ''}`}>
    <div className="summary-card-top">
      <h2 className="summary-card-title">{title}</h2>
      {Icon && <span className="summary-card-icon"><Icon size={19} aria-hidden="true" /></span>}
    </div>
    <p className="summary-card-value">{value}</p>
    <p className={`summary-card-change summary-card-change-${changeType}`}>{change}</p>
  </article>;
}
export default SummaryCard;
