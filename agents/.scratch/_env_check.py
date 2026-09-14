import re
vals = {}
with open('.env', encoding='utf-8') as f:
    for line in f:
        m = re.match(r'^([A-Z_]+)=(.*)$', line.strip())
        if m:
            vals[m.group(1)] = m.group(2)
for k in ['GMAIL_ADDRESS', 'GMAIL_APP_PASSWORD', 'EMAIL_TEST_RECIPIENT', 'TESSERACT_PATH', 'EMAIL_SENDER']:
    v = vals.get(k)
    state = 'SET(non-empty)' if v else 'UNSET/EMPTY'
    print(k + '=' + state)
