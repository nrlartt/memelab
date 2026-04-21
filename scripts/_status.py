from memedna.db import SessionLocal
from sqlalchemy import text


def main() -> None:
    with SessionLocal() as s:
        n = int(s.execute(text("SELECT count(*) FROM dna_families")).scalar_one())
        m = int(s.execute(text("SELECT count(*) FROM family_mutations")).scalar_one())
        t = int(s.execute(text("SELECT count(*) FROM tokens")).scalar_one())
        print(f"tokens={t}  families={n}  mutations={m}")
        rows = s.execute(
            text(
                "SELECT event_title, mutations_count "
                "FROM dna_families ORDER BY mutations_count DESC LIMIT 20"
            )
        ).all()
        print("top families by mutations:")
        for r in rows:
            print(f"  muts={r[1]:<5} {r[0][:85]}")


if __name__ == "__main__":
    main()
