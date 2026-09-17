/**
 * The mockups' table: a ground-filled header row with 11px uppercase labels,
 * hairline row rules, and no zebra striping.
 *
 * No zebra because the rows already sit inside a bordered card on a distinct
 * ground; striping them as well is a third level of separation for a
 * distinction nobody needs to make.
 *
 * `columns` is [{ key, header, render?, align? }]. `rows` must carry a stable
 * `id`.
 */
export function DataTable({ columns, rows, empty = 'Keine Einträge.', caption }) {
  if (!rows || rows.length === 0) {
    return <p className="py-6 text-center text-[13px] text-text-muted">{empty}</p>
  }

  return (
    // The wrapper scrolls, not the page: a wide table on a phone must not
    // introduce horizontal scroll on the document (SC-011).
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-full border-collapse text-left">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="bg-ground">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={`px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted ${
                  column.align === 'right' ? 'text-right' : ''
                }`}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-hairline-2 last:border-b-0">
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={`px-3 py-3 text-[13px] text-text ${
                    column.align === 'right' ? 'text-right' : ''
                  }`}
                >
                  {column.render ? column.render(row) : row[column.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default DataTable
