// Renders the summary card component.
function SummaryCard({
  title,
  value,
  change,
  changeType = "positive",
  icon: Icon,
}) {
  return (
    <article className="summary-card">
      <div className="summary-card-top">
        <div>
          <p className="summary-card-title">{title}</p>
          <h2>{value}</h2>
        </div>

        {Icon && (
          <div className="summary-card-icon">
            <Icon size={22} />
          </div>
        )}
      </div>

      <div
        className={[
          "summary-card-change",
          changeType === "negative"
            ? "summary-card-change-negative"
            : "summary-card-change-positive",
        ].join(" ")}
      >
        {change}
      </div>
    </article>
  );
}

export default SummaryCard;