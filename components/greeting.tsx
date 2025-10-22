import { motion } from "framer-motion";

export const Greeting = () => {
  return (
    <div
      className="mx-auto mt-4 flex size-full max-w-3xl flex-col justify-center px-4 md:mt-16 md:px-8"
      key="overview"
    >
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className="bg-gradient-primary bg-clip-text text-transparent font-semibold text-3xl md:text-4xl text-shadow float"
        exit={{ opacity: 0, y: 10 }}
        initial={{ opacity: 0, y: 10 }}
        transition={{ delay: 0.5 }}
      >
        Hello there!
      </motion.div>
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className="text-xl text-muted-foreground md:text-2xl mt-2 reveal-up"
        exit={{ opacity: 0, y: 10 }}
        initial={{ opacity: 0, y: 10 }}
        transition={{ delay: 0.6 }}
      >
        How can I help you today?
      </motion.div>
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className="glass-card hover-lift p-6 mt-8 rounded-2xl smooth-transition"
        exit={{ opacity: 0, y: 10 }}
        initial={{ opacity: 0, y: 10 }}
        transition={{ delay: 0.8 }}
      >
        <p className="text-sm text-muted-foreground text-center">
          Start a conversation by typing your message below. I'm here to help with any questions or tasks you have.
        </p>
      </motion.div>
    </div>
  );
};
