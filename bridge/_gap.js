const mysql = require("mysql");
const { getMysqlConfig, toDriverOptions } = require("./db-config");
const c = mysql.createConnection(toDriverOptions(getMysqlConfig({ connectTimeout: 15000 })));
const q = (s,a=[]) => new Promise((r,j)=>c.query(s,a,(e,x)=>e?j(e):r(x)));
(async () => {
  console.log("=== gap to that customer's PREVIOUS receipt, same day (last 30d) ===");
  console.log(JSON.stringify(await q(
    "select bucket, count(*) pairs from (" +
    "  select case" +
    "    when g <= 2  then 'a: <= 2 min'" +
    "    when g <= 5  then 'b: 2-5 min'" +
    "    when g <= 15 then 'c: 5-15 min'" +
    "    when g <= 60 then 'd: 15-60 min'" +
    "    else 'e: > 60 min' end bucket" +
    "  from (select timestampdiff(minute," +
    "          (select max(p.trandate) from pos_header p" +
    "            where trim(p.arcode)=trim(h.arcode) and p.posted=1" +
    "              and (p.is_return=0 or p.is_return is null)" +
    "              and p.trandate < h.trandate and date(p.trandate)=date(h.trandate))," +
    "          h.trandate) g" +
    "        from pos_header h where h.posted=1 and (h.is_return=0 or h.is_return is null)" +
    "          and h.trandate >= date_sub(curdate(), interval 30 day)" +
    "          and trim(coalesce(h.arcode,''))<>'') y where g is not null) z" +
    " group by bucket order by bucket"), null, 1));
  c.end();
})().catch(e => { console.error("ERR", e.message); process.exit(1); });
