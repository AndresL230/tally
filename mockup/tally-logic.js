class Component extends DCLogic {
  state = {
    screen: 'signin', email: '', startName: '', startLinkedin: '', pickedColor: null, sheet: false, readStep: 0, beat: false,
    detailIdx: null, adding: false, newName: '', newPrice: '',
    merchant: "Nong's Khao Man Gai", date: 'Aug 11, 2026', total: 75.50, tip: 10.62, taxRegion: 'nj',
    payer: 'me', pct: 50, settleText: '',
    items: [
      { id: 1, name: 'Khao man gai', qty: '\u00d72', price: 25.00, st: 0 },
      { id: 2, name: 'Fried chicken thigh', qty: '', price: 6.50, st: 0 },
      { id: 3, name: 'Papaya salad', qty: '', price: 8.75, st: 0 },
      { id: 4, name: 'Thai iced tea', qty: '\u00d72', price: 9.00, st: 0 },
      { id: 5, name: 'Sticky rice', qty: '', price: 4.25, st: 0 },
      { id: 6, name: 'Fresh spring rolls', qty: '', price: 5.75, st: 0 }
    ],
    entries: [
      { d: 'Jun 28', m: "Trader Joe's", payer: 'me', delta: 41.20, note: 'Halved by percentage — no line items on the photo.' },
      { d: 'Jul 2', m: 'Settle up', payer: 'friend', delta: -41.20, pay: true },
      { d: 'Jul 6', m: 'Lardo', payer: 'friend', delta: -33.75, total: 46.80, tax: 3.90, items: [
        { name: 'Muffuletta', qty: '', price: 16.00, st: 1 },
        { name: 'Pork belly banh mi', qty: '', price: 15.50, st: 0 },
        { name: 'Fries', qty: '', price: 5.50, st: 2 },
        { name: 'Lemonade', qty: '\u00d72', price: 5.90, st: 2 }
      ] },
      { d: 'Jul 11', m: 'Safeway', payer: 'me', delta: 62.10, total: 96.35, tax: 2.85, items: [
        { name: 'Chicken thighs', qty: '', price: 14.20, st: 0 },
        { name: 'Cold brew', qty: '', price: 11.99, st: 0 },
        { name: 'Eggs', qty: '\u00d72', price: 9.98, st: 2 },
        { name: 'Olive oil', qty: '', price: 18.49, st: 2 },
        { name: 'Rice, 5lb', qty: '', price: 12.75, st: 0 },
        { name: 'Yogurt', qty: '', price: 6.49, st: 1 },
        { name: 'Frozen dumplings', qty: '\u00d72', price: 12.98, st: 0 },
        { name: 'Sparkling water', qty: '', price: 6.62, st: 2 }
      ] },
      { d: 'Jul 18', m: 'Pok Pok', payer: 'me', delta: 24.90, note: 'Halved by percentage — no line items on the photo.' },
      { d: 'Jul 24', m: 'New Seasons', payer: 'friend', delta: -18.40, note: 'Entered by hand.' },
      { d: 'Aug 1', m: 'Kachka', payer: 'me', delta: 71.55, total: 118.40, tax: 9.85, items: [
        { name: 'Herring under fur coat', qty: '', price: 14.00, st: 0 },
        { name: 'Pelmeni', qty: '', price: 19.00, st: 2 },
        { name: 'Chicken Kiev', qty: '', price: 32.00, st: 0 },
        { name: 'Beet salad', qty: '', price: 12.00, st: 1 },
        { name: 'Horseradish vodka', qty: '\u00d74', price: 24.00, st: 2 }
      ] },
      { d: 'Aug 6', m: 'Fred Meyer', payer: 'me', delta: 18.10, total: 28.75, tax: 0, items: [
        { name: 'Paper towels', qty: '', price: 12.99, st: 2 },
        { name: 'Dish soap', qty: '', price: 5.49, st: 2 },
        { name: 'Trash bags', qty: '', price: 10.27, st: 0 }
      ] }
    ]
  };

  componentDidMount() {
    const C = this.colors();
    let el = document.getElementById('tally-accent');
    if (!el) { el = document.createElement('style'); el.id = 'tally-accent'; document.head.appendChild(el); }
    el.textContent = 'a{color:' + C.me + '}a:hover{color:' + C.hover + '}';
  }
  componentDidUpdate() { this.componentDidMount(); }
  componentWillUnmount() { clearInterval(this._t); }

  m(n) { const v = Math.abs(n).toFixed(2); return (n < 0 ? '-$' : '$') + v; }
  colors() {
    const me = this.state.pickedColor || this.props.meColor || '#0a8a9b';
    const sh = (hex, f) => { const n = parseInt(hex.slice(1), 16); const r = Math.round(((n >> 16) & 255) * f), g = Math.round(((n >> 8) & 255) * f), b = Math.round((n & 255) * f); return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join(''); };
    return { me, hover: sh(me, .8), deep: sh(me, .7), fr: this.props.friendColor || '#2c2823' };
  }
  friend() { return this.props.friendName || 'Jordan'; }
  deltaOf(e) {
    if (!e.items || !e.items.length) return e.delta;
    const sp = this.split(e.items, e.tax || 0, 0, e.total);
    return Math.round((e.payer === 'me' ? sp.frTot : -sp.meTot) * 100) / 100;
  }
  balance() { return this.state.entries.reduce((a, e) => a + this.deltaOf(e), 0); }

  go(screen) { clearInterval(this._t); this.setState({ screen, sheet: false, beat: false }); }

  startScan(scenario) {
    clearInterval(this._t);
    this.setState({ screen: 'reading', readStep: 0, sheet: false, beat: false, scenario });
    let i = 0;
    this._t = setInterval(() => {
      i++;
      if (i >= 5) {
        clearInterval(this._t);
        this.setState({ screen: scenario === 'fail' ? 'manual' : scenario === 'noitems' ? 'percent' : 'confirm' });
      } else this.setState({ readStep: i });
    }, 950);
  }

  regions() { return { nj: { rate: 0.06625, label: 'NJ 6.625%' }, ny: { rate: 0.08875, label: 'NY 8.875%' }, none: { rate: 0, label: 'Untaxed' } }; }

  split(items, tax, tip, total) {
    const sub = items.reduce((a, i) => a + i.price, 0);
    const frSub = items.reduce((a, i) => a + (i.st === 0 ? i.price : i.st === 2 ? i.price / 2 : 0), 0);
    const extra = Math.max(0, (total != null ? total : sub + tax + tip) - sub);
    const frExtra = sub ? extra * frSub / sub : 0;
    const frTot = frSub + frExtra;
    const tot = total != null ? total : sub + extra;
    return { sub, extra, frSub, meSub: sub - frSub, frExtra, meExtra: extra - frExtra, frTot, meTot: tot - frTot, total: tot };
  }

  math() {
    const s = this.state, r = (this.regions()[s.taxRegion] || this.regions().none).rate;
    const sub = s.items.reduce((a, i) => a + i.price, 0);
    const tax = Math.round(sub * r * 100) / 100;
    const total = Math.round((sub + tax + s.tip) * 100) / 100;
    return { ...this.split(s.items, tax, s.tip, total), tax, tip: s.tip };
  }

  addEntry(delta, extra) {
    const e = { d: this.state.date.replace(/,.*$/, ''), m: this.state.merchant, payer: this.state.payer, delta, ...(extra || {}) };
    this.setState(s => ({ entries: s.entries.concat([e]), screen: 'ledger', beat: false, adding: false, items: s.items.map(i => ({ ...i, st: 0 })) }));
  }

  renderVals() {
    const C = this.colors(), F = this.friend(), s = this.state, sc = s.screen;
    const bal = this.balance(), owedByFriend = bal > 0.005, open = Math.abs(bal) > 0.005;
    const mm = this.math();
    const dir = c => ({ color: c, fontWeight: 600 });
    const swatch = bg => ({ width: '13px', height: '13px', borderRadius: '3px', background: bg, display: 'inline-block', flex: 'none' });
    const halfBg = `linear-gradient(180deg, ${C.me} 0 50%, ${C.fr} 50% 100%)`;

    let run = 0;
    const rows = s.entries.map((e, idx) => {
      const dv = this.deltaOf(e);
      run += dv;
      const pos = dv > 0;
      return {
        open: () => this.setState({ screen: 'detail', detailIdx: idx }),
        merchant: e.pay ? 'Settle up' : e.m,
        sub: e.pay ? (e.payer === 'me' ? 'you paid ' + F : F + ' paid you') : e.d + ' \u00b7 ' + (e.payer === 'me' ? 'you paid' : F + ' paid'),
        amount: (pos ? '+' : '\u2212') + '$' + Math.abs(dv).toFixed(2),
        running: (Math.abs(run) < 0.005 ? 'even' : '$' + Math.abs(run).toFixed(2)),
        runStyle: { font: "400 11.5px 'IBM Plex Mono', monospace", textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: Math.abs(run) < 0.005 ? '#a8a298' : (run > 0 ? C.me : C.fr), opacity: .8 },
        dotStyle: { width: '9px', height: '9px', borderRadius: '50%', flex: 'none', background: e.pay ? 'transparent' : (pos ? C.me : C.fr), border: e.pay ? '1px solid rgba(0,0,0,.3)' : '0' },
        nameStyle: { font: (e.pay ? '400 15px' : '500 15px') + " Archivo, sans-serif", color: e.pay ? '#8a857c' : '#211f1c', fontStyle: e.pay ? 'italic' : 'normal', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
        amtStyle: { font: "500 15px 'IBM Plex Mono', monospace", fontVariantNumeric: 'tabular-nums', color: e.pay ? '#a8a298' : (pos ? C.me : C.fr) }
      };
    }).reverse();

    const items = s.items.map(i => ({
      name: i.name + (i.qty ? '  ' + i.qty : ''),
      priceText: '$' + i.price.toFixed(2),
      note: i.st === 0 ? F + "'s" : i.st === 1 ? 'Yours' : '$' + (i.price / 2).toFixed(2) + ' each',
      noteStyle: { display: 'block', marginTop: '3px', font: "500 11.5px 'IBM Plex Mono', monospace", color: i.st === 0 ? C.fr : i.st === 1 ? C.me : '#6f6a61' },
      spineStyle: { width: '10px', flex: 'none', background: i.st === 0 ? C.fr : i.st === 1 ? C.me : halfBg },
      bodyStyle: { flex: 1, display: 'flex', alignItems: 'center', padding: '13px 14px', minHeight: '62px', borderBottom: '1px solid rgba(0,0,0,.07)', background: i.st === 0 ? 'rgba(44,40,35,.05)' : i.st === 1 ? C.me + '1f' : C.me + '0d' },
      tap: () => this.setState(st => ({ items: st.items.map(x => x.id === i.id ? { ...x, st: (x.st + 1) % 3 } : x), beat: false }))
    }));

    const stepLabels = ['Sharpening the photo', 'Reading merchant and date', 'Finding line items', 'Adding it up'];
    const stepVals = ['', s.readStep >= 2 ? s.merchant.slice(0, 14) : '', s.readStep >= 3 ? '6 found' : '', s.readStep >= 4 ? '$75.50' : ''];
    const steps = stepLabels.map((label, n) => {
      const done = s.readStep > n + 0, cur = s.readStep === n;
      return {
        label, value: stepVals[n],
        markStyle: { width: '10px', height: '10px', flex: 'none', borderRadius: '2px', background: done || cur ? C.me : 'transparent', border: done || cur ? '0' : '1px solid rgba(0,0,0,.25)', animation: cur ? 'blip .8s ease-in-out infinite' : 'none' },
        labelStyle: { font: (done ? '500' : '400') + ' 15px Archivo, sans-serif', color: done || cur ? '#211f1c' : '#a8a298' }
      };
    });

    const payBtn = active => ({ flex: 1, height: '52px', borderRadius: '14px', cursor: 'pointer', font: '600 16px Archivo, sans-serif', border: active ? '0' : '1px solid rgba(0,0,0,.16)', background: active ? C.me : 'transparent', color: active ? '#fff' : '#6f6a61' });

    const noneMine = s.items.every(i => i.st === 0);
    const owedAmt = s.payer === 'me' ? mm.frTot : mm.meTot;
    const jump = (label, active, fn) => ({ label, go: fn, style: { textAlign: 'left', padding: '11px 13px', borderRadius: '10px', cursor: 'pointer', font: '500 13.5px Archivo, sans-serif', border: '1px solid ' + (active ? C.me : 'rgba(0,0,0,.12)'), background: active ? C.me + '22' : 'transparent', color: active ? C.deep : '#4a453d' } });

    const pctFr = s.total * s.pct / 100;

    const de = s.detailIdx != null ? s.entries[s.detailIdx] : null;
    const dHas = !!(de && de.items && de.items.length);
    const dSp = dHas ? this.split(de.items, de.tax || 0, 0, de.total) : null;
    const dDelta = de ? this.deltaOf(de) : 0, dPos = dDelta > 0;

    return {
      appName: this.props.appName || 'Tally', friendName: F,
      isDetail: sc === 'detail', isSignin: sc === 'signin',
      email: s.email,
      onEmail: e => this.setState({ email: e.target.value }),
      signIn: () => this.go('start'),
      sendCode: () => this.setState({ screen: 'code', code: '', codeBad: false, sent: true }),
      isCode: sc === 'code',
      code: s.code || '',
      emailShown: s.email.trim() || 'your email',
      codeBad: !!s.codeBad,
      codeCells: [0, 1, 2, 3, 4, 5].map(n => {
        const ch = (s.code || '')[n];
        const active = (s.code || '').length === n;
        return {
          char: ch || '',
          style: { flex: 1, height: '62px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', font: "600 26px 'IBM Plex Mono', monospace", background: '#fbfaf6', color: '#211f1c', border: '1px solid ' + (s.codeBad ? C.me : active ? C.me : ch ? 'rgba(0,0,0,.22)' : 'rgba(0,0,0,.12)') }
        };
      }),
      onCode: e => this.setState({ code: e.target.value.replace(/[^0-9]/g, '').slice(0, 6), codeBad: false }),
      verifyCode: () => {
        if ((s.code || '').length < 6) return;
        if (s.code === '000000') { this.setState({ codeBad: true }); return; }
        this.go('start');
      },
      verifyStyle: { flex: 'none', width: '100%', height: '58px', borderRadius: '16px', border: '0', cursor: 'pointer', font: '600 16px Archivo, sans-serif', background: (s.code || '').length === 6 ? C.me : 'rgba(0,0,0,.14)', color: (s.code || '').length === 6 ? '#fff' : '#8a857c' },
      resendLabel: s.resent ? 'New code sent' : 'Send a new code',
      resend: () => this.setState({ resent: true, code: '', codeBad: false }),
      isStart: sc === 'start',
      startName: s.startName, startLinkedin: s.startLinkedin,
      startFirstName: (s.startName.trim().split(' ')[0]) || 'person',
      onStartName: e => this.setState({ startName: e.target.value }),
      onStartLinkedin: e => this.setState({ startLinkedin: e.target.value }),
      wordmarkStyle: { letterSpacing: '.08em', color: C.me, fontWeight: 600 },
      slashBig: { position: 'absolute', left: '-4px', top: '20px', width: '58px', height: '4px', background: C.me, transform: 'rotate(-24deg)', transformOrigin: 'left center' },
      slashSmall: { position: 'absolute', left: '-3px', top: '16px', width: '48px', height: '3px', background: C.me, transform: 'rotate(-24deg)', transformOrigin: 'left center' },
      primaryBtn: { height: '58px', borderRadius: '16px', border: '0', background: C.me, color: '#fff', font: '600 16px Archivo, sans-serif', cursor: 'pointer' },
      primaryBtnWide: { width: '100%', height: '58px', borderRadius: '16px', border: '0', background: C.me, color: '#fff', font: '600 16px Archivo, sans-serif', cursor: 'pointer' },
      sheetBtn: { height: '60px', borderRadius: '16px', border: '0', background: C.me, color: '#fff', font: '600 16px Archivo, sans-serif', cursor: 'pointer' },
      addReceiptBtn: { flex: 1, height: '58px', borderRadius: '16px', border: '0', background: C.me, color: '#fff', font: '600 16px Archivo, sans-serif', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' },
      primaryBtnHover: { background: C.hover },
      linkBtn: { alignSelf: 'flex-start', marginTop: '18px', border: '0', background: 'transparent', padding: '0', font: '600 14px Archivo, sans-serif', color: C.deep, cursor: 'pointer' },
      noticeStyle: { marginTop: '18px', borderLeft: '3px solid ' + C.me, paddingLeft: '14px', font: '400 15px Archivo, sans-serif', lineHeight: 1.5, color: '#4a453d' },
      noticeBlock: { marginTop: '18px', borderLeft: '3px solid ' + C.me, paddingLeft: '14px' },
      beatStyle: { marginTop: '10px', font: '500 13px Archivo, sans-serif', color: C.deep, lineHeight: 1.4 },
      scanLine: { position: 'absolute', left: 0, right: 0, height: '2px', background: C.me, boxShadow: '0 0 18px 4px ' + C.me + '73', animation: 'scanline 1.15s ease-in-out infinite alternate' },
      backToSignin: () => this.go('signin'),
      palette: ['#0a8a9b', '#1b6ef3', '#d4437a', '#e4572e', '#7c3aed', '#0f8a5f'].map(hex => ({
        pick: () => this.setState({ pickedColor: hex }),
        style: { width: '46px', height: '46px', borderRadius: '50%', padding: '0', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: '2px solid ' + (C.me === hex ? hex : 'transparent') },
        inner: { display: 'block', width: C.me === hex ? '32px' : '38px', height: C.me === hex ? '32px' : '38px', borderRadius: '50%', background: hex }
      })),
      sampleMineSpine: { width: '9px', flex: 'none', background: C.me },
      sampleHalfSpine: { width: '9px', flex: 'none', background: halfBg },
      sampleTheirSpine: { width: '9px', flex: 'none', background: C.fr },
      sampleMineBody: { flex: 1, display: 'flex', alignItems: 'center', gap: '10px', padding: '11px 13px', borderBottom: '1px solid rgba(0,0,0,.06)', background: C.me + '1f' },
      sampleHalfBody: { flex: 1, display: 'flex', alignItems: 'center', gap: '10px', padding: '11px 13px', borderBottom: '1px solid rgba(0,0,0,.06)', background: C.me + '0d' },
      sampleTheirBody: { flex: 1, display: 'flex', alignItems: 'center', gap: '10px', padding: '11px 13px', background: 'rgba(44,40,35,.05)' },
      finishStart: () => this.go('pick'),
      isPick: sc === 'pick',
      backToStart: () => this.go('start'),
      ledgers: [
        { name: F, meta: '9 entries · last Aug 6', amt: bal, live: true },
        { name: 'Sam', meta: '2 entries · last Jun 14', amt: -12.00 },
        { name: 'Priya', meta: 'no entries yet', amt: 0 }
      ].map(l => ({
        name: l.name, meta: l.meta,
        amount: Math.abs(l.amt) < 0.005 ? 'even' : '$' + Math.abs(l.amt).toFixed(2),
        pick: () => this.go('ledger'),
        style: { display: 'flex', alignItems: 'center', gap: '13px', width: '100%', padding: '16px 15px', borderRadius: '14px', cursor: 'pointer', border: '1px solid ' + (l.live ? C.me : 'rgba(0,0,0,.13)'), background: 'transparent' },
        dotStyle: { width: '11px', height: '11px', borderRadius: '50%', flex: 'none', background: Math.abs(l.amt) < 0.005 ? 'transparent' : (l.amt > 0 ? C.me : C.fr), border: Math.abs(l.amt) < 0.005 ? '1px solid rgba(0,0,0,.28)' : '0' },
        amtStyle: { flex: 'none', font: "500 15px 'IBM Plex Mono', monospace", fontVariantNumeric: 'tabular-nums', color: Math.abs(l.amt) < 0.005 ? '#a8a298' : (l.amt > 0 ? C.me : C.fr) }
      })),
      startBtnStyle: { width: '100%', height: '58px', borderRadius: '16px', border: '0', cursor: 'pointer', font: '600 16px Archivo, sans-serif', background: s.startName.trim() ? C.me : 'rgba(0,0,0,.14)', color: s.startName.trim() ? '#fff' : '#8a857c' },
      backToLedger: () => this.setState({ screen: 'ledger', detailIdx: null }),
      detailTitle: de ? (de.pay ? 'Settle up' : de.m) : '',
      detailSub: de ? de.d + ', 2026 \u00b7 ' + (de.payer === 'me' ? 'you paid' : F + ' paid') : '',
      detailHasItems: dHas, detailShowNote: !!de && !dHas,
      detailNote: de ? (de.pay ? (de.payer === 'me' ? 'You paid ' + F + ' back.' : F + ' paid you back.') : (de.note || 'No line items recorded.')) : '',
      detailTotalText: de && de.total ? '$' + de.total.toFixed(2) : '',
      detailShowTotal: !!(de && de.total),
      detailTaxText: dSp ? '$' + dSp.extra.toFixed(2) : '',
      detailFriendExtra: dSp ? '$' + dSp.frExtra.toFixed(2) : '',
      detailMeExtra: dSp ? '$' + dSp.meExtra.toFixed(2) : '',
      detailFriendShare: dSp ? '$' + dSp.frTot.toFixed(2) : '',
      detailMeShare: dSp ? '$' + dSp.meTot.toFixed(2) : '',
      detailFriendStyle: dir(C.fr), detailMeStyle: dir(C.me),
      detailDelta: de ? (dPos ? '+' : '\u2212') + '$' + Math.abs(dDelta).toFixed(2) : '',
      detailDeltaStyle: { fontFamily: "'Instrument Serif', Georgia, serif", fontSize: '38px', lineHeight: 1, fontVariantNumeric: 'tabular-nums', color: de && de.pay ? '#6f6a61' : (dPos ? C.me : C.fr) },
      detailMoveLine: de ? (de.pay ? 'came off the balance' : (dPos ? F + ' owed you' : 'you owed ' + F)) : '',
      detailItems: dHas ? de.items.map(i => ({
        name: i.name + (i.qty ? '  ' + i.qty : ''),
        priceText: '$' + i.price.toFixed(2),
        note: i.st === 0 ? F + "'s" : i.st === 1 ? 'Yours' : '$' + (i.price / 2).toFixed(2) + ' each',
        noteStyle: { display: 'block', marginTop: '3px', font: "500 11.5px 'IBM Plex Mono', monospace", color: i.st === 0 ? C.fr : i.st === 1 ? C.me : '#6f6a61' },
        spineStyle: { width: '10px', flex: 'none', background: i.st === 0 ? C.fr : i.st === 1 ? C.me : halfBg },
        bodyStyle: { flex: 1, display: 'flex', alignItems: 'center', padding: '12px 14px', borderBottom: '1px solid rgba(0,0,0,.07)', background: i.st === 0 ? 'rgba(44,40,35,.05)' : i.st === 1 ? C.me + '1f' : C.me + '0d' }
      })) : [],
      isLedger: sc === 'ledger', isReading: sc === 'reading', isConfirm: sc === 'confirm',
      isManual: sc === 'manual', isPercent: sc === 'percent', isSettle: sc === 'settle',
      sheet: s.sheet, beat: s.beat,

      balanceOpen: open, isSettled: !open, hasEntries: s.entries.length > 0, isEmpty: s.entries.length === 0,
      balanceAbs: '$' + Math.abs(bal).toFixed(2),
      balanceLine: owedByFriend ? F + ' owes you' : 'You owe ' + F,
      balanceLineStyle: dir(owedByFriend ? C.me : C.fr),
      balanceBarStyle: { width: Math.min(100, Math.abs(bal) / 2) + '%', background: owedByFriend ? C.me : C.fr },
      settledLine: (() => {
        if (!s.entries.length) return 'Nothing owed either way.';
        const r = s.entries.filter(e => !e.pay).length, p = s.entries.filter(e => e.pay).length;
        const n = x => x === 1 ? 'one' : x === 2 ? 'two' : x === 3 ? 'three' : x === 4 ? 'four' : x === 5 ? 'five' : x === 6 ? 'six' : x === 7 ? 'seven' : x === 8 ? 'eight' : x === 9 ? 'nine' : String(x);
        const cap = w => w.charAt(0).toUpperCase() + w.slice(1);
        return 'Square since ' + s.entries[s.entries.length - 1].d + '. ' + cap(n(r)) + ' receipt' + (r === 1 ? '' : 's') + ', ' + n(p) + ' payment' + (p === 1 ? '' : 's') + '.';
      })(),
      rows,

      steps,
      items, itemCount: s.items.length,
      merchant: s.merchant, date: s.date,
      totalText: '$' + mm.total.toFixed(2),
      manualTotalText: '$' + s.total.toFixed(2),
      onMerchant: e => this.setState({ merchant: e.target.value }),
      onDate: e => this.setState({ date: e.target.value }),
      onTotal: e => { const v = parseFloat(String(e.target.value).replace(/[^0-9.]/g, '')); this.setState({ tip: isNaN(v) ? 0 : Math.max(0, Math.round((v - mm.sub - mm.tax) * 100) / 100) }); },
      onManualTotal: e => { const v = parseFloat(String(e.target.value).replace(/[^0-9.]/g, '')); this.setState({ total: isNaN(v) ? 0 : v }); },

      taxLabel: (this.regions()[s.taxRegion] || this.regions().none).label,
      taxText: '$' + mm.tax.toFixed(2), tipText: '$' + mm.tip.toFixed(2),
      regions: ['nj', 'ny', 'none'].map(k => ({
        label: this.regions()[k].label,
        set: () => this.setState({ taxRegion: k }),
        style: { padding: '7px 11px', borderRadius: '9px', cursor: 'pointer', font: "600 11.5px 'IBM Plex Mono', monospace", border: '1px solid ' + (s.taxRegion === k ? C.me : 'rgba(0,0,0,.14)'), background: s.taxRegion === k ? C.me + '22' : 'transparent', color: s.taxRegion === k ? C.deep : '#6f6a61' }
      })),

      adding: s.adding, newName: s.newName, newPrice: s.newPrice,
      startAdd: () => this.setState({ adding: true }),
      cancelAdd: () => this.setState({ adding: false, newName: '', newPrice: '' }),
      onNewName: e => this.setState({ newName: e.target.value }),
      onNewPrice: e => this.setState({ newPrice: e.target.value.replace(/[^0-9.]/g, '') }),
      addBtnStyle: { flex: 'none', height: '36px', padding: '0 14px', borderRadius: '10px', border: '0', cursor: 'pointer', font: '600 13px Archivo, sans-serif', background: (s.newName.trim() && parseFloat(s.newPrice) > 0) ? C.me : 'rgba(0,0,0,.14)', color: (s.newName.trim() && parseFloat(s.newPrice) > 0) ? '#fff' : '#8a857c' },
      addItem: () => {
        const p = parseFloat(s.newPrice);
        if (!s.newName.trim() || !(p > 0)) return;
        this.setState(st => ({ items: st.items.concat([{ id: Date.now(), name: st.newName.trim(), qty: '', price: p, st: 0 }]), newName: '', newPrice: '', adding: false, beat: false }));
      },
      payMe: () => this.setState({ payer: 'me' }), payFriend: () => this.setState({ payer: 'friend' }),
      payMeStyle: payBtn(s.payer === 'me'), payFriendStyle: payBtn(s.payer === 'friend'),
      payerLine: s.payer === 'me' ? 'you paid' : F + ' paid',

      extraText: '$' + mm.extra.toFixed(2),
      extraFriendText: '$' + mm.frExtra.toFixed(2), extraMeText: '$' + mm.meExtra.toFixed(2),
      extraFriendStyle: dir(C.fr), extraMeStyle: dir(C.me),
      owedAmount: '$' + owedAmt.toFixed(2),
      owedPrefix: s.payer === 'me' ? F + ' owes' : 'You owe',
      owedLine: 'of $' + mm.total.toFixed(2),
      shareFriendBar: { width: (mm.frTot / (mm.total || 1)) * 100 + '%', background: C.fr },
      shareMeBar: { width: (mm.meTot / (mm.total || 1)) * 100 + '%', background: C.me },
      commitLabel: s.beat ? 'Yes, all of it is ' + F + "'s" : 'Add to ledger',
      commitStyle: { width: '100%', height: '58px', marginTop: '12px', borderRadius: '16px', border: '0', cursor: 'pointer', font: '600 16px Archivo, sans-serif', background: s.beat ? '#211f1c' : C.me, color: '#fff' },
      commit: () => {
        if (noneMine && !s.beat) { this.setState({ beat: true }); return; }
        this.addEntry(s.payer === 'me' ? mm.frTot : -mm.meTot, { items: s.items.map(i => ({ name: i.name, qty: i.qty, price: i.price, st: i.st })), tax: mm.tax, total: mm.total, region: this.regions()[s.taxRegion].label });
      },

      pct: s.pct,
      onPct: e => this.setState({ pct: parseInt(e.target.value, 10) }),
      pctAllFriend: () => this.setState({ pct: 100 }), pctHalf: () => this.setState({ pct: 50 }), pctAllMe: () => this.setState({ pct: 0 }),
      pctFriendAmount: '$' + pctFr.toFixed(2), pctMeAmount: '$' + (s.total - pctFr).toFixed(2),
      pctFriendText: s.pct + '%', pctMeText: (100 - s.pct) + '%',
      pctFriendLabel: { font: '600 12px Archivo, sans-serif', color: C.fr, marginBottom: '2px' },
      pctMeLabel: { font: '600 12px Archivo, sans-serif', color: C.me, marginBottom: '2px' },
      pctOwedAmount: '$' + (s.payer === 'me' ? pctFr : s.total - pctFr).toFixed(2),
      pctOwedPrefix: s.payer === 'me' ? F + ' owes' : 'You owe',
      pctOwedLine: 'of $' + s.total.toFixed(2),
      commitPct: () => this.addEntry(s.payer === 'me' ? pctFr : -(s.total - pctFr)),

      settleDirection: owedByFriend ? F + ' is paying you back.' : 'You are paying ' + F + ' back.',
      settleText: s.settleText || Math.abs(bal).toFixed(2),
      onSettle: e => this.setState({ settleText: e.target.value.replace(/[^0-9.]/g, '') }),
      recordPayment: () => {
        const v = parseFloat(s.settleText || Math.abs(bal).toFixed(2)) || 0;
        this.setState(st => ({ entries: st.entries.concat([{ d: 'Aug 11', m: 'Settle up', payer: owedByFriend ? 'friend' : 'me', delta: owedByFriend ? -v : v, pay: true }]), screen: 'ledger', settleText: '' }));
      },

      openSheet: () => this.setState({ sheet: true }), closeSheet: () => this.setState({ sheet: false }),
      openSettle: () => this.go('settle'), goLedger: () => this.go('ledger'),
      scanOk: () => this.startScan('ok'), manualStart: () => this.go('manual'),
      retake: () => this.startScan('ok'),

      swatchMe: swatch(C.me), swatchFriend: swatch(C.fr), swatchHalf: swatch(halfBg),
      jumps: [
        jump('Sign in', sc === 'signin', () => this.go('signin')),
        jump('Enter the code', sc === 'code', () => this.setState({ screen: 'code', code: '', codeBad: false })),
        jump('Get started', sc === 'start', () => this.go('start')),
        jump('Pick a ledger', sc === 'pick', () => this.go('pick')),
        jump('Ledger', sc === 'ledger', () => this.go('ledger')),
        jump('Reading the photo', sc === 'reading', () => this.startScan('ok')),
        jump('Confirm (hero)', sc === 'confirm', () => this.go('confirm')),
        jump('No line items found', sc === 'percent', () => this.startScan('noitems')),
        jump("Photo didn't read", sc === 'manual', () => this.startScan('fail')),
        jump('Entry detail', sc === 'detail', () => this.setState({ screen: 'detail', detailIdx: s.entries.length - 1 })),
        jump('Settle up', sc === 'settle', () => this.go('settle')),
        jump('Balance at zero', false, () => this.setState({ screen: 'ledger', entries: this.state.entries.concat([{ d: 'Aug 11', m: 'Settle up', payer: 'friend', delta: -this.balance(), pay: true }]) })),
        jump('Empty ledger', false, () => this.setState({ screen: 'ledger', entries: [] })),
        jump('Reset the demo', false, () => window.location.reload())
      ]
    };
  }
}
