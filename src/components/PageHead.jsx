/**
 * PageHead — greeting + subtitle on the left, chips on the right.
 * `chips` is an array of { tone, k?, v?, text? }:
 *   k/v renders the mockups' "label value" chip; text renders a plain one.
 */
export default function PageHead({ greeting, subtitle, chips = [] }) {
  return (
    <div className="page-head">
      <div>
        <p className="greeting">{greeting}</p>
        <p className="subtitle">{subtitle}</p>
      </div>
      <div className="chips">
        {chips.map((c, i) => (
          <span key={i} className={`chip ${c.tone}`}>
            {c.k ? (
              <>
                <span className="k">{c.k}</span> <span className="v">{c.v}</span>
              </>
            ) : (
              c.text
            )}
          </span>
        ))}
      </div>
    </div>
  )
}
