const PlaceholderPage = ({ title }: { title: string }) => {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-heading font-bold text-foreground">{title}</h1>
      <p className="text-muted-foreground">
        Esta sección está en desarrollo. Próximamente disponible.
      </p>
    </div>
  );
};

export default PlaceholderPage;
