-- Order-to-cash questions. Same grain as the collections dashboard.
-- Tables match the star schema on the case-study page
-- (fact_invoice, dim_customer, dim_terms). SQLite flavour.

-- 1. Late rate and cash that cleared after due date.
SELECT
    COUNT(*) AS closed_invoices,
    ROUND(AVG(CASE WHEN clear_date > due_in_date THEN 1.0 ELSE 0 END), 4) AS late_rate,
    ROUND(SUM(CASE WHEN clear_date > due_in_date THEN amount ELSE 0 END), 2) AS late_amount
FROM fact_invoice
WHERE is_open = 0;

-- 2. Terms that look cheap until you see the late rate (CA10 vs NAM4).
SELECT term,
       COUNT(*) AS invoices,
       ROUND(AVG(CASE WHEN clear_date > due_in_date THEN 1.0 ELSE 0 END), 4) AS late_rate,
       ROUND(AVG(julianday(clear_date) - julianday(posting_date)), 1) AS median_days_to_pay
FROM fact_invoice
WHERE is_open = 0
GROUP BY term
HAVING COUNT(*) >= 200
ORDER BY late_rate DESC;

-- 3. Open AR aging — what is sitting past due right now.
SELECT
    CASE
        WHEN julianday('2020-05-19') - julianday(due_in_date) <= 0 THEN 'current'
        WHEN julianday('2020-05-19') - julianday(due_in_date) <= 30 THEN '1-30'
        WHEN julianday('2020-05-19') - julianday(due_in_date) <= 60 THEN '31-60'
        WHEN julianday('2020-05-19') - julianday(due_in_date) <= 90 THEN '61-90'
        ELSE '90+'
    END AS bucket,
    COUNT(*) AS invoices,
    ROUND(SUM(amount), 2) AS open_balance
FROM fact_invoice
WHERE is_open = 1
GROUP BY 1
ORDER BY 1;

-- 4. Who to call tomorrow: customer historical median × open amount.
WITH closed AS (
    SELECT customer_id,
           AVG(julianday(clear_date) - julianday(posting_date)) AS med_days
    FROM fact_invoice
    WHERE is_open = 0
    GROUP BY customer_id
)
SELECT i.invoice_id,
       i.customer_id,
       ROUND(i.amount, 2) AS amount,
       ROUND(COALESCE(c.med_days, 15), 1) AS predicted_days,
       ROUND(COALESCE(c.med_days, 15) * i.amount, 0) AS call_priority
FROM fact_invoice i
LEFT JOIN closed c USING (customer_id)
WHERE i.is_open = 1
ORDER BY call_priority DESC
LIMIT 20;
