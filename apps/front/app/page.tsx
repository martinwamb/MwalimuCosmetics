const mockProducts = [
  { id: "p-1", name: "Shea Body Butter", description: "Rich, whipped body butter for deep moisture.", price: 15.5 },
  { id: "p-2", name: "Vitamin C Serum", description: "Brightening daily serum for glowing skin.", price: 25.0 },
  { id: "p-3", name: "Matte Lipstick", description: "Long wear pigment in signature shades.", price: 12.0 }
];

export default function Page() {
  return (
    <div className="grid grid-cols-3 gap-6">
      {mockProducts.map((product) => (
        <article className="card" key={product.id}>
          <div className="pill">In Stock</div>
          <h3>{product.name}</h3>
          <p className="muted">{product.description}</p>
          <p style={{ fontWeight: 700, margin: "0.5rem 0 1rem" }}>USD {product.price.toFixed(2)}</p>
          <button className="button">Add to Cart</button>
        </article>
      ))}
    </div>
  );
}
