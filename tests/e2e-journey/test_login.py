"""Test login credentials for employees and role accounts."""
import sys, os
sys.path.insert(0, ".")
from supabase import create_client
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(".env"), override=True)
url = os.environ["SUPABASE_URL"]
anon = os.environ["SUPABASE_ANON_KEY"]

client = create_client(url, anon)

def try_login(email, password, label=""):
    try:
        r = client.auth.sign_in_with_password({"email": email, "password": password})
        if r.user:
            client.auth.sign_out()
            return True
    except Exception:
        pass
    return False

# Try employee password patterns for Emp082
emp_email = "emp082@gmail.com"
patterns = [
    "Emp082@123", "Employee@Emp082", "Password@Emp082",
    "exitai@Emp082", "Emp082Pass!", "emp082@gmail.com",
    "Emp082#Pass", "Pass@Emp082", "ExitAI@Emp082",
    "Emp082!123", "Emp082@Pass1", "demo@Emp082",
]
print("=== Testing employee password patterns ===")
found = False
for p in patterns:
    if try_login(emp_email, p):
        print(f"SUCCESS: {emp_email} / {p}")
        found = True
        break
if not found:
    print(f"All patterns failed for {emp_email}")

# Try role accounts
print("\n=== Testing role accounts ===")
role_accounts = [
    ("siva@company.com", ["Siva@123", "HRSiva@123", "siva@123", "HR@123", "company@123"]),
    ("aravidhan@company.com", ["Aravidhan@123", "Manager@123", "aravidhan@123"]),
    ("aswin@gmail.com", ["Aswin@123", "IT@123", "aswin@123"]),
    ("anfiacj@gmail.com", ["Anfia@123", "Finance@123", "anfiacj@123"]),
]
for email, passwords in role_accounts:
    ok = False
    for p in passwords:
        if try_login(email, p):
            print(f"SUCCESS: {email} / {p}")
            ok = True
            break
    if not ok:
        print(f"UNKNOWN: {email} — none of {len(passwords)} patterns worked")
