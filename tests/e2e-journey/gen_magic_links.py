"""Generate one-time magic links for all test users needed for browser health check."""
import sys, json
sys.path.insert(0, ".")
from agents.core.config import db

REDIRECT_TO = "http://localhost:5173"

# Get all test user emails
role_map = {
    "hr": "siva@company.com",
    "manager": "aravidhan@company.com",
    "it": "aswin@gmail.com",
    "finance": "anfiacj@gmail.com",
}
emp_map = {
    "disp002": "disp-test-002@test.invalid",  # fresh disposable — browser pipeline test
    "emp082": "emp082@gmail.com",  # seeded; keep for reference only
    "emp083": "emp083@gmail.com",  # CLI/extra test
}

links = {}

for key, email in {**role_map, **emp_map}.items():
    try:
        result = db.auth.admin.generate_link({
            "type": "magiclink",
            "email": email,
            "options": {"redirect_to": REDIRECT_TO},
        })
        links[key] = {
            "email": email,
            "action_link": result.properties.action_link.replace(
                "redirect_to=http%3A%2F%2Flocalhost%3A3000",
                f"redirect_to={REDIRECT_TO.replace(':', '%3A').replace('/', '%2F')}"
            ),
        }
        print(f"OK {key} ({email})")
    except Exception as e:
        links[key] = {"email": email, "error": str(e)[:100]}
        print(f"FAIL {key}: {e}")

# Save for use by Playwright
with open("tests/e2e-journey/magic_links.json", "w") as f:
    json.dump(links, f, indent=2)
print("\nSaved to tests/e2e-journey/magic_links.json")
print(json.dumps(links, indent=2))
