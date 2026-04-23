// Placeholder home page.
//
// The real authenticated UI lands in T-017 once WorkOS sign-in is wired
// up. This page exists today purely so the routing test in App.test.tsx
// has something to render at "/" and so the hello-world API contract is
// exercised end-to-end through the Eden client.

import { useGetHelloWorld } from "@/hooks/api/useGetHelloWorld";

export function Home() {
  const { isLoading, data } = useGetHelloWorld();

  return (
    <main>
      <h1>Home</h1>
      {isLoading ? <p>Loading...</p> : <p>{data?.message}</p>}
    </main>
  );
}

export default Home;
