CHECKOUT_SUCCESS = """<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Checkout Successful | MarkType</title>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap" rel="stylesheet">
<style>*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Outfit',sans-serif;background:radial-gradient(circle at center,#18181b 0%,#09090b 100%);color:#f4f4f5;min-height:100vh;display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative}
.glow{position:absolute;width:400px;height:400px;background:radial-gradient(circle,rgba(245,158,11,0.08) 0%,transparent 70%);top:50%;left:50%;transform:translate(-50%,-50%);z-index:0;pointer-events:none}
.card{background:rgba(24,24,27,0.4);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.08);border-radius:24px;padding:3.5rem 2rem;max-width:440px;width:90%;text-align:center;box-shadow:0 25px 50px -12px rgba(0,0,0,0.5);z-index:10;animation:fadeIn 0.8s cubic-bezier(0.16,1,0.3,1) forwards}
@keyframes fadeIn{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
.checkmark-wrapper{width:80px;height:80px;border-radius:50%;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.2);display:flex;align-items:center;justify-content:center;margin:0 auto 2rem;box-shadow:0 0 20px rgba(16,185,129,0.15);animation:pulse 2s infinite}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(16,185,129,0.4)}70%{box-shadow:0 0 0 15px rgba(16,185,129,0)}100%{box-shadow:0 0 0 0 rgba(16,185,129,0)}}
h1{font-size:2rem;font-weight:700;margin-bottom:.75rem;background:linear-gradient(135deg,#fb923c 0%,#f59e0b 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;letter-spacing:-0.02em}
.subtitle{font-size:1.1rem;font-weight:600;color:#e4e4e7;margin-bottom:1.25rem}
p{font-size:.95rem;color:#a1a1aa;line-height:1.6;margin-bottom:2.25rem}
.btn{display:inline-block;width:100%;padding:.9rem 2rem;font-size:.95rem;font-weight:600;color:#09090b;background:linear-gradient(135deg,#fb923c 0%,#f59e0b 100%);border:none;border-radius:12px;cursor:pointer;text-decoration:none;box-shadow:0 4px 15px rgba(245,158,11,0.25);transition:all .2s cubic-bezier(0.16,1,0.3,1)}
.btn:hover{transform:translateY(-2px);box-shadow:0 8px 25px rgba(245,158,11,0.35)}
</style></head>
<body><div class="glow"></div><div class="card"><div class="checkmark-wrapper"><svg viewBox="0 0 52 52" width="40" height="40"><circle cx="26" cy="26" r="25" fill="none" stroke="#10b981" stroke-width="3" stroke-dasharray="166" stroke-dashoffset="166"><animate attributeName="stroke-dashoffset" from="166" to="0" dur=".6s" begin=".2s" fill="freeze"/></circle><path d="M14.1 27.2l7.1 7.2 16.7-16.8" fill="none" stroke="#10b981" stroke-width="4" stroke-linecap="round" stroke-dasharray="48" stroke-dashoffset="48"><animate attributeName="stroke-dashoffset" from="48" to="0" dur=".3s" begin=".7s" fill="freeze"/></path></svg></div><h1>Payment Successful!</h1><div class="subtitle">Thank you for upgrading</div><p>Your subscription has been processed successfully. You can now close this tab and return to the MarkType app to access your new plan features.</p><button onclick="window.close()" class="btn">Close Window</button></div></body>
</html>"""

EMAIL_ADDED_TO_TEAM = """<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Added to {team_name}</title>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap" rel="stylesheet">
<style>
body{{font-family:'Outfit',sans-serif;background-color:#09090b;color:#f4f4f5;margin:0;padding:0;-webkit-font-smoothing:antialiased}}
.wrapper{{width:100%;background-color:#09090b;padding:40px 0}}
.container{{max-width:500px;margin:0 auto;background:#18181b;border:1px solid rgba(255,255,255,0.08);border-radius:20px;padding:40px;text-align:center;box-shadow:0 20px 40px rgba(0,0,0,0.5)}}
.logo{{font-size:24px;font-weight:700;letter-spacing:-0.03em;background:linear-gradient(135deg,#fb923c 0%,#f59e0b 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:30px;display:inline-block}}
h1{{font-size:22px;font-weight:600;margin-top:0;margin-bottom:16px;color:#fff;letter-spacing:-0.01em}}
p{{font-size:15px;color:#a1a1aa;line-height:1.6;margin-bottom:30px}}
.btn{{display:inline-block;background:linear-gradient(135deg,#fb923c 0%,#f59e0b 100%);color:#09090b!important;font-weight:600;font-size:14px;text-decoration:none;padding:14px 30px;border-radius:12px;box-shadow:0 4px 15px rgba(245,158,11,0.25);margin-bottom:25px}}
.divider{{height:1px;background:rgba(255,255,255,0.08);margin:30px 0}}
.footer{{font-size:12px;color:#52525b;margin-top:20px}}
</style></head>
<body><div class="wrapper"><div class="container"><div class="logo">MarkType</div><h1>Welcome to the Team!</h1><p><strong>{admin_name}</strong> has added you to the team <strong>"{team_name}"</strong> on MarkType.</p><p>You can now switch to the team workspace in the MarkType app to access shared files and collaborate.</p><a href="marktype://open" class="btn">Open MarkType</a><div class="divider"></div><div class="footer">Please sign the team agreement document on your first switch to the team workspace.</div></div></div></body>
</html>"""

EMAIL_INVITATION = """<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Invitation to join {team_name}</title>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap" rel="stylesheet">
<style>
body{{font-family:'Outfit',sans-serif;background-color:#09090b;color:#f4f4f5;margin:0;padding:0;-webkit-font-smoothing:antialiased}}
.wrapper{{width:100%;background-color:#09090b;padding:40px 0}}
.container{{max-width:500px;margin:0 auto;background:#18181b;border:1px solid rgba(255,255,255,0.08);border-radius:20px;padding:40px;text-align:center;box-shadow:0 20px 40px rgba(0,0,0,0.5)}}
.logo{{font-size:24px;font-weight:700;letter-spacing:-0.03em;background:linear-gradient(135deg,#fb923c 0%,#f59e0b 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:30px;display:inline-block}}
h1{{font-size:22px;font-weight:600;margin-top:0;margin-bottom:16px;color:#fff;letter-spacing:-0.01em}}
p{{font-size:15px;color:#a1a1aa;line-height:1.6;margin-bottom:30px}}
.btn{{display:inline-block;background:linear-gradient(135deg,#fb923c 0%,#f59e0b 100%);color:#09090b!important;font-weight:600;font-size:14px;text-decoration:none;padding:14px 30px;border-radius:12px;box-shadow:0 4px 15px rgba(245,158,11,0.25);margin-bottom:25px}}
.footer{{font-size:12px;color:#52525b;margin-top:20px}}
</style></head>
<body><div class="wrapper"><div class="container"><div class="logo">MarkType</div><h1>You've been invited!</h1><p><strong>{admin_name}</strong> has invited you to join the team <strong>"{team_name}"</strong> on MarkType.</p><p>Once you join, you will be added to the team workspace automatically.</p><a href="https://app.marktype.io/join?token={token}" class="btn">View Invitation</a><div class="divider"></div><p style="font-size:12px;color:#71717a">Or open in the app: <a href="marktype://join?token={token}" style="color:#fb923c;text-decoration:none">marktype://join?token={token}</a></p><div class="footer">This invitation is valid for 7 days.</div></div></div></body>
</html>"""
