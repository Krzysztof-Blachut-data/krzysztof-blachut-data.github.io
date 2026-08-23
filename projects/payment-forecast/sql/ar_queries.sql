-- Pytania o należności. To samo ziarno co na dashboardzie.
-- Tabele jak na stronie projektu (fact_invoice, dim_customer, dim_terms). Dialekt SQLite.
-- AVG to średnia. W Pythonie model używa mediany historii klienta.

-- 1. Odsetek płatności po terminie oraz kwota spłacona po terminie.
SELECT
    COUNT(*) AS closed_invoices,
    ROUND(AVG(CASE WHEN clear_date > due_in_date THEN 1.0 ELSE 0 END), 4) AS paid_after_due_share,
    ROUND(SUM(CASE WHEN clear_date > due_in_date THEN amount ELSE 0 END), 2) AS paid_after_due_amount
FROM fact_invoice
WHERE is_open = 0;

-- 2. Terminy płatności a odsetek płatności po terminie (CA10 vs NAM4).
SELECT term,
       COUNT(*) AS invoices,
       ROUND(AVG(CASE WHEN clear_date > due_in_date THEN 1.0 ELSE 0 END), 4) AS paid_after_due_share,
       ROUND(AVG(julianday(clear_date) - julianday(posting_date)), 1) AS avg_days_to_pay
FROM fact_invoice
WHERE is_open = 0
GROUP BY term
HAVING COUNT(*) >= 200
ORDER BY paid_after_due_share DESC;

-- 3. Struktura nieopłaconych należności według dni po terminie.
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

-- 4. Priorytet kontaktu: kwota × max(przewidywane dni po terminie, dni po terminie, 0).
--    W SQL średnia dni do spłaty; w Pythonie mediana.
WITH closed AS (
    SELECT customer_id,
           AVG(julianday(clear_date) - julianday(posting_date)) AS avg_days
    FROM fact_invoice
    WHERE is_open = 0
    GROUP BY customer_id
)
SELECT i.invoice_id,
       i.customer_id,
       ROUND(i.amount, 2) AS amount,
       ROUND(COALESCE(c.avg_days, 15), 1) AS predicted_days,
       ROUND(
           i.amount * MAX(
               COALESCE(c.avg_days, 15) - (julianday(i.due_in_date) - julianday(i.posting_date)),
               julianday('2020-05-19') - julianday(i.due_in_date),
               0
           ),
           0
       ) AS call_priority
FROM fact_invoice i
LEFT JOIN closed c USING (customer_id)
WHERE i.is_open = 1
ORDER BY call_priority DESC
LIMIT 20;
