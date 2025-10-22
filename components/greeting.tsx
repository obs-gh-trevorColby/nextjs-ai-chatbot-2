import { motion } from "framer-motion";

export const Greeting = () => {
  return (
    <div
      className="relative mx-auto mt-4 flex size-full max-w-3xl flex-col justify-center px-4 md:mt-16 md:px-8"
      key="overview"
    >
      {/* Background decoration */}
      <div className="absolute inset-0 rounded-2xl bg-mesh-gradient opacity-30" />

      <div className="relative z-10">
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="mb-2 font-semibold text-gradient-primary text-xl md:text-2xl"
          exit={{ opacity: 0, y: 10 }}
          initial={{ opacity: 0, y: 10 }}
          transition={{ delay: 0.5 }}
        >
          Hello there!
        </motion.div>
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 text-muted-foreground text-xl md:text-2xl"
          exit={{ opacity: 0, y: 10 }}
          initial={{ opacity: 0, y: 10 }}
          transition={{ delay: 0.6 }}
        >
          How can I help you today?
        </motion.div>

        {/* Decorative elements */}
        <motion.div
          animate={{ opacity: 1, scale: 1 }}
          className="mt-8 flex flex-wrap justify-center gap-2"
          exit={{ opacity: 0, scale: 0.9 }}
          initial={{ opacity: 0, scale: 0.9 }}
          transition={{ delay: 0.8 }}
        >
          <div className="badge-enhanced animate-float">💬 Ask anything</div>
          <div
            className="badge-enhanced animate-float"
            style={{ animationDelay: "0.5s" }}
          >
            🚀 Get creative
          </div>
          <div
            className="badge-enhanced animate-float"
            style={{ animationDelay: "1s" }}
          >
            🎯 Solve problems
          </div>
        </motion.div>
      </div>
    </div>
  );
};
