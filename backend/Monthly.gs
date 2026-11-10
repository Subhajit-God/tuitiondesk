/**
 * TuitionDesk backend — Monthly.gs : the monthly report to parents.
 * ONE message per family (grouped by guardian WhatsApp number) covering every active child: attendance %, tests published that month,
 * fee status and credit, and the pay link when something is due. Messages go into the normal send queue (Teacher sends each one) —
 * nothing is sent by this software. Language follows the family's chosen language (first child's).
 */
var Monthly = (function () {
  function monthRange(period) { var y = parseInt(period.slice(0, 4), 10), m = parseInt(period.slice(5, 7), 10), last = new Date(Date.UTC(y, m, 0)).getUTCDate(); return { from: period + '-01', to: period + '-' + Util.pad(last, 2) }; }
  function prevMonth(today) { var y = parseInt(today.slice(0, 4), 10), m = parseInt(today.slice(5, 7), 10) - 1; if (m < 1) { m = 12; y--; } return y + '-' + Util.pad(m, 2); }
  function monthName(period, lang) { return PayLinks.monthLabel(period); }
  function childBlock(st, r, L, sym) {
    var a = Attendance.summaryFor(st.student_id, r.from, r.to), lines = [];
    lines.push('• ' + st.full_name.split(/\s+/)[0] + ':');
    lines.push(a.percentage === null ? '  ' + L.m_att_na : '  ' + L.m_att + ': ' + a.percentage + '% (' + a.counts.P + ' ' + L.m_of + ' ' + (a.counts.P + a.counts.A) + ')');
    var tests = Tests.resultsFor(st.student_id).filter(function (x) { return x.testDate >= r.from && x.testDate <= r.to && x.resultStatus === 'entered'; });
    if (tests.length) lines.push('  ' + L.m_tests + ': ' + tests.map(function (x) { return x.title + ' ' + x.marks + '/' + x.maxMarks; }).join(', '));
    var bal = Ledger.totals(Ledger.fees(st.student_id).filter(function (v) { return v.recordStatus === 'active'; })).balance, cr = Ledger.credit(st.student_id);
    lines.push('  ' + (bal > 0 ? L.m_fee_due + ': ' + sym + bal.toFixed(2) : L.m_fee_clear) + (cr > 0 ? ' (' + L.m_credit + ' ' + sym + cr.toFixed(2) + ')' : ''));
    return lines.join('\n');
  }
  /** Build (writes nothing) the family messages for a month. */
  function build(ctx, period, preview) {
    var r = monthRange(period), sym = Settings.get('currency_symbol'), fam = {}, out = [];
    Db.filter('Students', function (s) { return s.status === 'active'; }).sort(function (a, b) { return a.admission_date < b.admission_date ? -1 : a.student_id < b.student_id ? -1 : 1; }).forEach(function (s) { var k = s.guardian_whatsapp || ('nophone:' + s.student_id); (fam[k] = fam[k] || []).push(s); });
    Object.keys(fam).forEach(function (phone) {
      var kids = fam[phone], first = kids[0], lang = Notifications.langOf(first), L = LANG_TEXT[lang] || LANG_TEXT.en, item = { guardianPhone: first.guardian_whatsapp, students: kids.map(function (k) { return k.full_name; }), language: lang, action: 'send', note: '', key: 'monthly:' + period + ':' + phone, message: '', studentId: first.student_id };
      if (!first.guardian_whatsapp) { item.action = 'blocked'; item.note = 'No WhatsApp number on file.'; return out.push(item); }
      if (kids.every(function (k) { return k.whatsapp_consent === 'no'; })) { item.action = 'blocked'; item.note = 'Guardian has opted out of messages.'; return out.push(item); }
      var head = Notifications.render('tpl_monthly_head', { centre: Settings.get('centre_name'), guardian: Notifications.guardian(first), month: monthName(period) }, lang);
      var owing = kids.some(function (k) { return PayLinks.dues(k.student_id).paise > 0; }), pl = owing ? PayLinks.line(ctx, first.student_id, { preview: !!preview, lang: lang }) : '';
      item.message = head + '\n' + kids.map(function (k) { return childBlock(k, r, L, sym); }).join('\n') + (pl ? '\n' + pl.trim() : '') + '\n' + L.m_foot;
      if (Db.find('Notifications', function (n) { return n.idempotency_key === item.key; })) { item.action = 'exists'; item.note = 'Already prepared for ' + period + '.'; }
      out.push(item);
    });
    return out;
  }
  function period_(p) { var d = p && p.period ? V.period(p.period, 'period') : prevMonth(Util.today()); if (d >= Util.monthOf(Util.today())) V.fail('period', 'must be a month that has finished'); return d; }
  return {
    preview: function (ctx, p) { var per = period_(p); return { period: per, items: build(ctx, per, true) }; },
    /** Queue one message per family (idempotent per month + family). */
    run: function (ctx, p) {
      var per = period_(p), created = 0, skipped = 0;
      build(ctx, per, false).forEach(function (i) {
        if (i.action !== 'send') { skipped++; return; }
        var r = Notifications.create(ctx, { key: i.key, trigger: 'monthly_report', studentId: i.studentId, template: 'tpl_monthly_head', templateVersion: Notifications.ver('tpl_monthly_head'), relatedType: 'report', relatedId: per, message: i.message });
        if (r.created) created++; else skipped++;
      });
      Audit.log(ctx, 'monthly_report.run', 'report', per, { created: created, skipped: skipped });
      return { period: per, created: created, skipped: skipped };
    }
  };
})();
